-- ============================================================
-- Idempotência em public.agregar_saldos_mensais
--
-- Hoje a função soma no acumulado (linha original):
--   total_debitos = saldos_mensais.total_debitos + EXCLUDED.total_debitos
--
-- Isso é aditivo por design (para permitir múltiplos uploads no
-- mesmo período), mas não tem NENHUMA trava contra ser chamada duas
-- vezes para o MESMO upload_id. E o fluxo que a chama
-- (src/lib/diario/uploader.ts, salvarDiarioUpload) é uma sequência
-- de chamadas de rede separadas e não-transacionais do navegador:
--   1) INSERT diario_uploads (status=processing)
--   2) INSERT lancamentos_diario em lotes de até 1000 linhas
--   3) RPC agregar_saldos_mensais(upload_id)
--   4) UPDATE diario_uploads (status=done)
--
-- Se o passo 3 for reenviado (timeout de rede em que o servidor já
-- processou mas o navegador não recebeu a resposta, duplo clique,
-- nova tentativa manual, etc.), os saldos_mensais desse upload são
-- contabilizados DUAS VEZES, sem erro nenhum — os relatórios
-- (DRE/Balanço/indicadores) passam a mostrar valores dobrados para
-- as contas daquele upload, silenciosamente.
--
-- A correção trava a linha do upload (FOR UPDATE) e marca um flag
-- `agregado` dentro da MESMA transação da função: uma segunda
-- chamada com o mesmo upload_id vira no-op.
-- ============================================================

ALTER TABLE public.diario_uploads
  ADD COLUMN IF NOT EXISTS agregado boolean NOT NULL DEFAULT false;

-- Uploads que já estão com status='done' hoje presumivelmente já
-- passaram pela agregação uma vez — marca como já agregados para
-- não mudar o comportamento de dados existentes.
UPDATE public.diario_uploads SET agregado = true WHERE status = 'done' AND agregado = false;

CREATE OR REPLACE FUNCTION public.agregar_saldos_mensais(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _agregado boolean;
BEGIN
  -- Trava a linha do upload até o fim da transação e verifica se
  -- este upload já foi agregado antes (retry seguro / idempotente).
  SELECT agregado INTO _agregado
  FROM public.diario_uploads
  WHERE id = _upload_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'diario_uploads % não encontrado', _upload_id;
  END IF;

  IF _agregado THEN
    RETURN; -- já agregado — no-op, evita contar o upload duas vezes
  END IF;

  INSERT INTO public.saldos_mensais (tenant_id, company_id, conta_codigo, competencia, total_debitos, total_creditos)
  SELECT tenant_id, company_id, conta_codigo, competencia,
         SUM(debito), SUM(credito)
  FROM public.lancamentos_diario
  WHERE upload_id = _upload_id
  GROUP BY tenant_id, company_id, conta_codigo, competencia
  ON CONFLICT (company_id, conta_codigo, competencia) DO UPDATE
    SET total_debitos = public.saldos_mensais.total_debitos + EXCLUDED.total_debitos,
        total_creditos = public.saldos_mensais.total_creditos + EXCLUDED.total_creditos,
        updated_at = now();

  UPDATE public.diario_uploads SET agregado = true WHERE id = _upload_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.agregar_saldos_mensais(uuid) FROM anon, public;

-- reverter_upload_diario: ao reverter (ex.: exclusão do upload para
-- reprocessar), também reseta o flag — defensivo, já que hoje o
-- fluxo de remoção (removerUpload) sempre apaga a linha de
-- diario_uploads logo em seguida, mas evita um estado inconsistente
-- caso esse RPC passe a ser reaproveitado sem apagar o upload.
CREATE OR REPLACE FUNCTION public.reverter_upload_diario(_upload_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company uuid;
BEGIN
  SELECT company_id INTO _company FROM public.diario_uploads WHERE id = _upload_id;
  IF _company IS NULL THEN RETURN; END IF;

  WITH agg AS (
    SELECT conta_codigo, competencia, SUM(debito) d, SUM(credito) c
    FROM public.lancamentos_diario
    WHERE upload_id = _upload_id
    GROUP BY conta_codigo, competencia
  )
  UPDATE public.saldos_mensais s
     SET total_debitos = s.total_debitos - agg.d,
         total_creditos = s.total_creditos - agg.c,
         updated_at = now()
    FROM agg
   WHERE s.company_id = _company
     AND s.conta_codigo = agg.conta_codigo
     AND s.competencia = agg.competencia;

  DELETE FROM public.saldos_mensais
   WHERE company_id = _company
     AND total_debitos = 0 AND total_creditos = 0;

  DELETE FROM public.lancamentos_diario WHERE upload_id = _upload_id;

  UPDATE public.diario_uploads SET agregado = false WHERE id = _upload_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.reverter_upload_diario(uuid) FROM anon, public;
