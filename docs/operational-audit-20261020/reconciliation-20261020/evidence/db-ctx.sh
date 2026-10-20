# usage: ctx SUBJECT DEPT [SUPPORT_DEPT]  -> prints the exact preamble used by withPostgresAuthorization
ctx(){ echo "begin;"; echo "set local role authenticated;"; echo "select set_config('tracepoint.subject_id','$1',true) is not null as subj_set, set_config('tracepoint.department_id','$2',true) is not null as dept_set$( [ -n "$3" ] && echo ", set_config('tracepoint.support_department_id','$3',true) is not null as support_set");"; }
# run one app "query" in its own transaction (as PostgresDataClient does)
tx(){ ctx "$1" "$2" "$3"; echo "$4"; echo "commit;"; }
RT(){ /usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 55493 -U tracepoint_runtime -d tpverify -X -e -v ON_ERROR_STOP=0 "$@"; }
SU(){ /usr/lib/postgresql/16/bin/psql -h 127.0.0.1 -p 55493 -U postgres -d tpverify -X -e "$@"; }
DA=dddddddd-0000-4000-8000-00000000000a; DB=dddddddd-0000-4000-8000-00000000000b
ADMA=a0000000-0000-4000-8000-0000000000a1; FM=a0000000-0000-4000-8000-0000000000f1; INSP=a0000000-0000-4000-8000-0000000000e1
OFF=a0000000-0000-4000-8000-0000000000c1; OFF2=a0000000-0000-4000-8000-0000000000c2; EQM=a0000000-0000-4000-8000-0000000000d1
ADMB=b0000000-0000-4000-8000-0000000000a1; PA=90000000-0000-4000-8000-000000000001; NM=80000000-0000-4000-8000-000000000001
VEH=feee0000-0000-4000-8000-00000000000a; VEQ=fe000000-0000-4000-8000-0000000000e1
