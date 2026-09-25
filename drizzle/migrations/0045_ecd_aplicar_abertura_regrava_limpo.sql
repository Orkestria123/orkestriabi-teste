DO $mig$
DECLARE _def text;
BEGIN
  _def := pg_get_functiondef('public.ecd_aplicar_abertura(uuid)'::regprocedure);
  _def := replace(_def,
    '_data_abert := (_primeiro - INTERVAL ''1 day'')::date;',
    '_data_abert := (_primeiro - INTERVAL ''1 day'')::date;
  -- Regrava limpo: destino que mudou no de-para não pode ficar em dobro.
  DELETE FROM public.saldos_abertura a
   WHERE a.company_id = _company AND a.data_referencia = _data_abert
     AND a.origem_ecd = _importacao_id;');
  IF position('Regrava limpo' in _def) = 0 THEN RAISE EXCEPTION 'trecho não encontrado'; END IF;
  EXECUTE _def;
END
$mig$;