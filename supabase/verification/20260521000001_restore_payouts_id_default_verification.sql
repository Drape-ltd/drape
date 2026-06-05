select column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'payouts'
  and column_name = 'id';
