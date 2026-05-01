select jobid, jobname, schedule, command
from cron.job
where jobname = 'release-order-payouts';
