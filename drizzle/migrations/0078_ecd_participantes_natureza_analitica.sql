DO $migration$
DECLARE definicao text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO definicao FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='ecd_criar_participantes';
 IF position('CASE WHEN origem_nat IN' in definicao)=0 THEN RAISE EXCEPTION 'Definição inesperada'; END IF;
 definicao:=replace(definicao,$old$CASE WHEN origem_nat IN ('01','1') THEN 'D' WHEN origem_nat IN ('02','2') THEN 'C' ELSE natureza END$old$,$new$'A'::text$new$);
 EXECUTE definicao;
END;
$migration$;