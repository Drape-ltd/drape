'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from './button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = 'No records found.',
}: {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  emptyMessage?: string
}): React.JSX.Element {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  })

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-ui-muted">
            {headerGroup.headers.map((header) => {
              const sorted = header.column.getIsSorted()
              const sortable = header.column.getCanSort()
              return (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : sortable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3 h-8 px-3 text-xs uppercase text-ui-subtle"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? <ArrowUp /> : sorted === 'desc' ? <ArrowDown /> : <ChevronsUpDown />}
                    </Button>
                  ) : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.length > 0 ? table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} data-state={row.getIsSelected() ? 'selected' : undefined}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
            ))}
          </TableRow>
        )) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-28 text-center text-ui-subtle">{emptyMessage}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
