ALTER TABLE public.ajustes_gerenciais
  ADD COLUMN movimenta_dfc boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ajustes_gerenciais.movimenta_dfc IS 'Quando false, o ajuste é desconsiderado apenas no cálculo da DFC; permanece válido nas demais demonstrações e indicadores.';