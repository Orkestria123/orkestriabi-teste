CREATE OR REPLACE FUNCTION public.ecd_dc_movimento(_saldo_inicial numeric, _debitos numeric, _creditos numeric, _saldo_final numeric, _resultado boolean, _zerar text DEFAULT NULL::text)
 RETURNS TABLE(debito numeric, credito numeric)
 LANGUAGE sql IMMUTABLE SET search_path TO 'public' SET statement_timeout TO '300s'
AS $function$
  -- Lado do zeramento: o saldo acumulado da própria conta manda (conta
  -- redutora, como ICMS s/Compras, tem saldo credor dentro do custo).
  -- A natureza do destino só decide quando a conta nasceu no mês.
  SELECT
    CASE WHEN NOT encerrou THEN d WHEN lado = 'D' THEN 0::numeric ELSE d END,
    CASE WHEN NOT encerrou THEN c WHEN lado = 'D' THEN c ELSE 0::numeric END
  FROM (
    SELECT COALESCE(_debitos,0) AS d, COALESCE(_creditos,0) AS c,
      COALESCE(_resultado,false) AND abs(COALESCE(_saldo_final,0)) < 0.005
        AND (abs(COALESCE(_saldo_inicial,0)) >= 0.005
             OR (COALESCE(_debitos,0) > 0 AND COALESCE(_creditos,0) > 0)) AS encerrou,
      CASE
        WHEN COALESCE(_saldo_inicial,0) <= -0.005 THEN 'D'
        WHEN COALESCE(_saldo_inicial,0) >= 0.005 THEN 'C'
        WHEN upper(COALESCE(_zerar,'')) IN ('D','C') THEN upper(_zerar)
        ELSE 'D'
      END AS lado
  ) t;
$function$;