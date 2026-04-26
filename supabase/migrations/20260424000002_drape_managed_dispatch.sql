alter type order_stage add value if not exists 'READY_FOR_DRAPE_DISPATCH' before 'OUT_FOR_DELIVERY';
