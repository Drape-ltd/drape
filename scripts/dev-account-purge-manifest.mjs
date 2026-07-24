#!/usr/bin/env -S deno run

import postgres from 'npm:postgres@3.4.7'

const DEV_PROJECT_REF = 'pqptfuqogvrajozfsqzi'
const TARGET_SCHEMAS = ['auth', 'public', 'storage']
const MAX_PASSES = 6

function parseArgs(argv) {
  const emails = []
  const userIds = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--email' && argv[index + 1]) {
      emails.push(argv[index + 1].trim().toLowerCase())
      index += 1
    } else if (argv[index] === '--user-id' && argv[index + 1]) {
      userIds.push(argv[index + 1].trim())
      index += 1
    }
  }

  if (emails.length === 0 && userIds.length === 0) {
    throw new Error(
      'Pass at least one account with --email user@example.com or --user-id uuid',
    )
  }

  const invalidUserIds = userIds.filter((userId) => !isUuid(userId))
  if (invalidUserIds.length > 0) {
    throw new Error(`Invalid --user-id values: ${invalidUserIds.join(', ')}`)
  }

  return {
    compact: argv.includes('--compact'),
    emails: [...new Set(emails)],
    userIds: [...new Set(userIds)],
  }
}

function asText(value) {
  if (value === null || value === undefined) return null
  return String(value)
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

function relationFragment(tx, table) {
  return tx.unsafe(
    `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`,
  )
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    String(value),
  )
}

function rowKey(table, row) {
  const primaryValues = table.primaryKeys.map((column) => asText(row[column]))
  if (primaryValues.length > 0 && primaryValues.every(Boolean)) {
    return primaryValues.join('|')
  }

  return JSON.stringify(row)
}

function isDirectUserColumn(column) {
  return new Set([
    'user_id',
    'auth_user_id',
    'customer_id',
    'tailor_id',
    'sender_id',
    'actor_id',
    'owner_id',
    'requested_by',
    'submitted_by',
    'created_by',
    'updated_by',
    'reviewer_id',
    'verified_by',
    'resolved_by',
    'reported_by',
    'recipient_id',
    'target_user_id',
  ]).has(column)
}

function isEntityReferenceColumn(column) {
  return column.endsWith('_id') && column !== 'id'
}

function pickSummary(table, row) {
  const fields = [
    ...table.primaryKeys,
    'email',
    'user_id',
    'customer_id',
    'tailor_id',
    'tailor_profile_id',
    'order_id',
    'owner_id',
    'sender_id',
    'actor_id',
    'bucket_id',
    'name',
    'status',
    'stage',
    'created_at',
  ]
  const summary = {}

  for (const field of fields) {
    if (!(field in row)) continue
    const value = row[field]
    if (value === null || value === undefined || value === '') continue
    summary[field] = value
  }

  return summary
}

async function main() {
  const { compact, emails, userIds } = parseArgs(Deno.args)
  const databaseUrl = Deno.env.get('DIRECT_URL') || Deno.env.get('DATABASE_URL')
  const supabaseUrl = Deno.env.get('NEXT_PUBLIC_SUPABASE_URL') || ''

  if (!databaseUrl) throw new Error('DIRECT_URL or DATABASE_URL is required')
  if (!supabaseUrl.includes(DEV_PROJECT_REF)) {
    throw new Error(`Refusing to inspect a non-DEV project. Expected ${DEV_PROJECT_REF}.`)
  }

  const sql = postgres(databaseUrl, {
    ssl: 'require',
    max: 1,
    connect_timeout: 15,
    idle_timeout: 2,
  })

  try {
    const manifest = await sql.begin(async (tx) => {
      await tx`set transaction read only`
      await tx`set local statement_timeout = '8s'`

      const authUsers = await tx`
        select
          id::text as id,
          lower(email) as email,
          created_at,
          last_sign_in_at
        from auth.users
        where lower(email) = any(${tx.array(emails, 1009)})
        order by lower(email)
      `

      if (authUsers.length !== emails.length) {
        const found = new Set(authUsers.map((row) => row.email))
        const missing = emails.filter((email) => !found.has(email))
        throw new Error(`No DEV auth user found for: ${missing.join(', ')}`)
      }

      const columnRows = await tx`
        select
          table_schema,
          table_name,
          column_name,
          data_type,
          udt_name,
          ordinal_position
        from information_schema.columns
        where table_schema = any(${tx.array(TARGET_SCHEMAS, 1009)})
        order by table_schema, table_name, ordinal_position
      `

      const primaryKeyRows = await tx`
        select
          ns.nspname as table_schema,
          rel.relname as table_name,
          array_agg(att.attname order by key_column.ordinality) as primary_keys
        from pg_constraint constraint_info
        join pg_class rel on rel.oid = constraint_info.conrelid
        join pg_namespace ns on ns.oid = rel.relnamespace
        cross join lateral unnest(constraint_info.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_attribute att
          on att.attrelid = rel.oid
         and att.attnum = key_column.attnum
        where constraint_info.contype = 'p'
          and ns.nspname = any(${tx.array(TARGET_SCHEMAS, 1009)})
        group by ns.nspname, rel.relname
      `

      const primaryKeysByTable = new Map(
        primaryKeyRows.map((row) => [
          `${row.table_schema}.${row.table_name}`,
          row.primary_keys,
        ]),
      )

      const tablesByName = new Map()
      for (const row of columnRows) {
        const tableName = `${row.table_schema}.${row.table_name}`
        const table = tablesByName.get(tableName) ?? {
          schema: row.table_schema,
          name: row.table_name,
          columns: [],
          columnTypes: new Map(),
          primaryKeys: primaryKeysByTable.get(tableName) ?? [],
        }
        table.columns.push(row.column_name)
        table.columnTypes.set(row.column_name, {
          dataType: row.data_type,
          udtName: row.udt_name,
        })
        tablesByName.set(tableName, table)
      }
      const tables = [...tablesByName.values()]
      const matches = new Map()
      const principalIds = new Set([
        ...authUsers.map((row) => row.id),
        ...userIds,
      ])
      const entityIds = new Set(principalIds)

      function addRows(table, rows) {
        if (rows.length === 0) return 0
        const tableName = `${table.schema}.${table.name}`
        const existing = matches.get(tableName) ?? new Map()
        let added = 0

        for (const row of rows) {
          const key = rowKey(table, row)
          if (existing.has(key)) continue
          existing.set(key, row)
          added += 1

          for (const primaryKey of table.primaryKeys) {
            const value = asText(row[primaryKey])
            if (value) entityIds.add(value)
          }
        }

        if (existing.size > 0) matches.set(tableName, existing)
        return added
      }

      async function queryMatches(table, columns, values) {
        const targetColumns = columns.filter((column) => table.columns.includes(column))
        if (targetColumns.length === 0 || values.length === 0) return []
        const relation = relationFragment(tx, table)
        const selectedColumns = tx(table.columns)
        let predicate = tx`false`
        let predicateCount = 0

        for (const column of targetColumns) {
          const targetColumn = tx(column)
          const columnType = table.columnTypes.get(column)
          if (columnType?.udtName === 'uuid') {
            const uuidValues = values.filter(isUuid)
            if (uuidValues.length === 0) continue
            predicate = tx`${predicate} or ${targetColumn} = any(${tx.array(uuidValues, 2951)})`
          } else if (
            columnType?.dataType === 'text' ||
            columnType?.dataType === 'character varying' ||
            columnType?.dataType === 'character'
          ) {
            predicate = tx`${predicate} or ${targetColumn} = any(${tx.array(values, 1009)})`
          } else {
            continue
          }
          predicateCount += 1
        }
        if (predicateCount === 0) return []

        try {
          return await tx`
            select ${selectedColumns}
            from ${relation}
            where ${predicate}
            limit 5000
          `
        } catch (error) {
          throw new Error(
            `Manifest query failed for ${table.schema}.${table.name} (${targetColumns.join(', ')}): ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      for (const table of tables) {
        const emailColumns = table.columns.filter(
          (column) => column === 'email' || column.endsWith('_email'),
        )
        const directUserColumns = table.columns.filter(isDirectUserColumn)

        addRows(table, await queryMatches(table, emailColumns, emails))
        addRows(
          table,
          await queryMatches(table, directUserColumns, [...principalIds]),
        )
      }

      async function propagateEntityMatches() {
        for (let pass = 0; pass < MAX_PASSES; pass += 1) {
          const idsAtPassStart = [...entityIds]
          let addedThisPass = 0

          for (const table of tables) {
            addedThisPass += addRows(
              table,
              await queryMatches(
                table,
                table.columns.filter(isEntityReferenceColumn),
                idsAtPassStart,
              ),
            )
          }

          if (addedThisPass === 0) break
        }
      }

      await propagateEntityMatches()

      // Mutable queued work stores ownership in explicit JSON keys. Match those
      // keys natively; broad JSON substring scans are slow and would sweep
      // immutable audit/event payloads that account deletion should retain.
      const jobQueueTable = tables.find(
        (table) => table.schema === 'public' && table.name === 'job_queue',
      )
      if (jobQueueTable) {
        const relation = relationFragment(tx, jobQueueTable)
        const selectedColumns = tx(jobQueueTable.columns)
        const ids = [...entityIds]
        const queuedRows = await tx`
          select ${selectedColumns}
          from ${relation}
          where payload ->> 'userId' = any(${tx.array(ids, 1009)})
             or payload ->> 'recipientUserId' = any(${tx.array(ids, 1009)})
             or payload ->> 'orderId' = any(${tx.array(ids, 1009)})
             or payload -> 'order' ->> 'id' = any(${tx.array(ids, 1009)})
          limit 5000
        `
        addRows(jobQueueTable, queuedRows)
        await propagateEntityMatches()
      }

      const tableManifest = [...matches.entries()]
        .map(([tableName, rows]) => {
          const table = tables.find(
            (candidate) => `${candidate.schema}.${candidate.name}` === tableName,
          )
          return {
            table: tableName,
            count: rows.size,
            rows: [...rows.values()].map((row) => pickSummary(table, row)),
          }
        })
        .sort((left, right) => left.table.localeCompare(right.table))

      return {
        projectRef: DEV_PROJECT_REF,
        mode: 'READ_ONLY_MANIFEST',
        requestedEmails: emails,
        requestedUserIds: userIds,
        authUsers,
        schemasReviewed: TARGET_SCHEMAS,
        baseTablesReviewed: tables.length,
        matchedTables: tableManifest.length,
        matchedRows: tableManifest.reduce((sum, entry) => sum + entry.count, 0),
        tables: tableManifest,
      }
    })

    const output = compact
      ? {
          ...manifest,
          tables: manifest.tables.map(({ table, count }) => ({ table, count })),
        }
      : manifest
    console.log(JSON.stringify(output, null, 2))
  } finally {
    await sql.end({ timeout: 2 })
  }
}

await main()
