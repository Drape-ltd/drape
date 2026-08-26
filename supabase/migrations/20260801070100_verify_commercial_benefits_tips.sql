-- Rollback-only structural and policy proof for Implementation 10.
do $verification$
declare v_campaign uuid; v_benefit uuid;
begin
  if has_function_privilege('authenticated','public.reserve_order_benefit(text,uuid,text,uuid,text)','EXECUTE') then raise exception 'Clients must not reserve benefits directly.'; end if;
  if not exists(select 1 from pg_trigger where tgname='commercial_redemptions_append_only') then raise exception 'Benefit redemptions are not append-only.'; end if;
  if not exists(select 1 from pg_trigger where tgname='order_tip_events_append_only') then raise exception 'Tip events are not append-only.'; end if;
  begin
    insert into public.commercial_campaigns(name,status,funding_source,currency,budget_amount) values('Implementation 10 verification','ACTIVE','DRAPEON','USD',10000) returning id into v_campaign;
    insert into public.commercial_benefits(campaign_id,kind,value,maximum_amount,currency) values(v_campaign,'PERCENT_DISCOUNT',2000,1500,'USD') returning id into v_benefit;
    insert into public.commercial_promotion_codes(benefit_id,code) values(v_benefit,'VERIFY10');
    begin
      insert into public.commercial_campaigns(name,status,funding_source,feature_key) values('Forbidden sweepstakes','ACTIVE','DRAPEON','SWEEPSTAKES');
      raise exception 'A gated campaign was activated.';
    exception when check_violation then null; end;
    raise exception 'ROLLBACK_IMPLEMENTATION_10_PROOF';
  exception when others then if sqlerrm<>'ROLLBACK_IMPLEMENTATION_10_PROOF' then raise; end if; end;
  raise notice 'Implementation 10 controlled-core schema, feature gates, append-only history, and RPC boundary passed; synthetic rows rolled back.';
end;
$verification$;
