DO $mig$
DECLARE _def text;
BEGIN
  _def := pg_get_functiondef('public.ecd_aplicar_mes(uuid,date,boolean)'::regprocedure);
  _def := replace(_def,
    '_usa_diario := COALESCE(_deb_lcto, 0) > 0;',
    '_usa_diario := COALESCE(_deb_lcto, 0) > 0;
  -- Diário incompleto (envio interrompido): o I155 confere e, se o I250
  -- não bate com ele, o mês usa o saldo — nunca meio diário.
  IF _usa_diario AND COALESCE(_deb_saldo, 0) > 0
     AND abs(_deb_lcto - _deb_saldo) / _deb_saldo > 0.005 THEN
    _usa_diario := false;
  END IF;
  -- Regravação limpa do mês: tira o que esta importação gravou antes
  -- (códigos que mudaram de destino no de-para ficariam em dobro).
  DELETE FROM public.saldos_mensais m
   WHERE m.company_id = _company AND m.competencia = _competencia
     AND m.origem_ecd = _importacao_id;');
  IF position('Regravação limpa do mês' in _def) = 0 THEN
    RAISE EXCEPTION 'trecho não encontrado';
  END IF;
  EXECUTE _def;
END
$mig$;