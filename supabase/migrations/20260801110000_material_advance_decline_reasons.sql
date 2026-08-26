alter table public.order_material_advances
  add column if not exists customer_response_reason text;

alter table public.order_material_advances
  drop constraint if exists order_material_advances_customer_response_reason_check;

alter table public.order_material_advances
  add constraint order_material_advances_customer_response_reason_check
  check (
    customer_response_reason is null
    or customer_response_reason in (
      'FIND_CHEAPER_OPTION',
      'CONTINUE_WITHOUT_MATERIAL',
      'AMOUNT_TOO_HIGH',
      'PROOF_OR_DETAILS_UNCLEAR',
      'WRONG_ITEM_OR_SCOPE',
      'OTHER',
      'NOT_SPECIFIED'
    )
  );

comment on column public.order_material_advances.customer_response_reason is
  'Structured customer decline reason. NOT_SPECIFIED preserves compatibility with older clients.';
