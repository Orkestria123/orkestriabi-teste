CREATE OR REPLACE FUNCTION public.plano_marcar_pai_sintetica()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_participante OR NEW.conta_pai_classificacao IS NULL THEN RETURN NEW; END IF;
  UPDATE public.plano_contas p SET is_sintetica = true, updated_at = now()
   WHERE p.tenant_id = NEW.tenant_id
     AND p.classificacao = NEW.conta_pai_classificacao
     AND NOT p.is_sintetica AND NOT p.is_participante
     AND (p.company_id IS NULL OR p.company_id IS NOT DISTINCT FROM NEW.company_id)
     AND p.id <> NEW.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_plano_pai_sintetica ON public.plano_contas;
CREATE TRIGGER trg_plano_pai_sintetica
AFTER INSERT OR UPDATE OF conta_pai_classificacao, classificacao ON public.plano_contas
FOR EACH ROW EXECUTE FUNCTION public.plano_marcar_pai_sintetica();

UPDATE public.plano_contas p SET is_sintetica = true, updated_at = now()
 WHERE NOT p.is_sintetica AND NOT p.is_participante
   AND EXISTS (SELECT 1 FROM public.plano_contas f
                WHERE f.tenant_id = p.tenant_id AND f.conta_pai_classificacao = p.classificacao
                  AND f.id <> p.id AND NOT f.is_participante
                  AND (p.company_id IS NULL OR f.company_id IS NOT DISTINCT FROM p.company_id));