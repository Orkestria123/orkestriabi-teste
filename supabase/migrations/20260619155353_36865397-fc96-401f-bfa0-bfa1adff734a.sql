
CREATE TABLE public.mascara_classificacao (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  separador TEXT NOT NULL DEFAULT '.',
  niveis JSONB NOT NULL DEFAULT '[{"nome":"Grupo"},{"nome":"Subgrupo"},{"nome":"Conta"},{"nome":"Subconta"},{"nome":"Analítica"}]'::jsonb,
  grupos JSONB NOT NULL DEFAULT '{"1":"ativo","2":"passivo","3":"despesa","4":"receita","5":"resultado"}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mascara_classificacao TO authenticated;
GRANT ALL ON public.mascara_classificacao TO service_role;

ALTER TABLE public.mascara_classificacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mascara tenant access"
  ON public.mascara_classificacao FOR ALL
  TO authenticated
  USING (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin())
  WITH CHECK (tenant_id = public.get_my_tenant_id() OR public.is_orkestria_admin());

CREATE TRIGGER update_mascara_classificacao_updated_at
  BEFORE UPDATE ON public.mascara_classificacao
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
