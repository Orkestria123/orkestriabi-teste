export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_balances: {
        Row: {
          codigo_conta: string
          company_id: string
          creditos: number | null
          debitos: number | null
          id: string
          periodo: string
          saldo_final: number | null
          saldo_inicial: number | null
          sped_file_id: string | null
          tenant_id: string
        }
        Insert: {
          codigo_conta: string
          company_id: string
          creditos?: number | null
          debitos?: number | null
          id?: string
          periodo: string
          saldo_final?: number | null
          saldo_inicial?: number | null
          sped_file_id?: string | null
          tenant_id: string
        }
        Update: {
          codigo_conta?: string
          company_id?: string
          creditos?: number | null
          debitos?: number | null
          id?: string
          periodo?: string
          saldo_final?: number | null
          saldo_inicial?: number | null
          sped_file_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_balances_sped_file_id_fkey"
            columns: ["sped_file_id"]
            isOneToOne: false
            referencedRelation: "sped_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ajustes_gerenciais: {
        Row: {
          company_id: string
          competencia: string
          conta_credito: string
          conta_debito: string
          created_at: string
          criado_por: string | null
          descricao: string
          id: string
          justificativa: string | null
          tenant_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          company_id: string
          competencia: string
          conta_credito: string
          conta_debito: string
          created_at?: string
          criado_por?: string | null
          descricao: string
          id?: string
          justificativa?: string | null
          tenant_id: string
          updated_at?: string
          valor: number
        }
        Update: {
          company_id?: string
          competencia?: string
          conta_credito?: string
          conta_debito?: string
          created_at?: string
          criado_por?: string | null
          descricao?: string
          id?: string
          justificativa?: string | null
          tenant_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "ajustes_gerenciais_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajustes_gerenciais_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajustes_gerenciais_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          codigo_conta: string
          company_id: string
          id: string
          natureza: string | null
          nivel: number | null
          nome_conta: string | null
          parent_codigo: string | null
          sped_file_id: string | null
          tenant_id: string
          tipo_conta: string | null
        }
        Insert: {
          codigo_conta: string
          company_id: string
          id?: string
          natureza?: string | null
          nivel?: number | null
          nome_conta?: string | null
          parent_codigo?: string | null
          sped_file_id?: string | null
          tenant_id: string
          tipo_conta?: string | null
        }
        Update: {
          codigo_conta?: string
          company_id?: string
          id?: string
          natureza?: string | null
          nivel?: number | null
          nome_conta?: string | null
          parent_codigo?: string | null
          sped_file_id?: string | null
          tenant_id?: string
          tipo_conta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_sped_file_id_fkey"
            columns: ["sped_file_id"]
            isOneToOne: false
            referencedRelation: "sped_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          ativo: boolean
          cnpj: string | null
          created_at: string
          fonte_dados: string
          id: string
          name: string
          razao_social: string | null
          regime_tributario: string | null
          tenant_id: string
        }
        Insert: {
          ativo?: boolean
          cnpj?: string | null
          created_at?: string
          fonte_dados?: string
          id?: string
          name: string
          razao_social?: string | null
          regime_tributario?: string | null
          tenant_id: string
        }
        Update: {
          ativo?: boolean
          cnpj?: string | null
          created_at?: string
          fonte_dados?: string
          id?: string
          name?: string
          razao_social?: string | null
          regime_tributario?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contas_gerenciais: {
        Row: {
          classificacao: string
          codigo: string
          company_id: string
          created_at: string
          descricao: string
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          classificacao: string
          codigo: string
          company_id: string
          created_at?: string
          descricao: string
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          classificacao?: string
          codigo?: string
          company_id?: string
          created_at?: string
          descricao?: string
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_gerenciais_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_gerenciais_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_config: {
        Row: {
          bloco: string
          company_id: string
          config: Json
          created_at: string
          id: string
          ordem: number
          tenant_id: string
          updated_at: string
          visivel: boolean
        }
        Insert: {
          bloco: string
          company_id: string
          config?: Json
          created_at?: string
          id?: string
          ordem?: number
          tenant_id: string
          updated_at?: string
          visivel?: boolean
        }
        Update: {
          bloco?: string
          company_id?: string
          config?: Json
          created_at?: string
          id?: string
          ordem?: number
          tenant_id?: string
          updated_at?: string
          visivel?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      diario_uploads: {
        Row: {
          company_id: string
          competencia_fim: string | null
          competencia_inicio: string | null
          contas_desconhecidas: number
          created_at: string
          erro_detalhe: string | null
          filename: string
          id: string
          partidas_fechadas: boolean | null
          status: string
          tenant_id: string
          total_creditos: number
          total_debitos: number
          total_lancamentos: number
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          competencia_fim?: string | null
          competencia_inicio?: string | null
          contas_desconhecidas?: number
          created_at?: string
          erro_detalhe?: string | null
          filename: string
          id?: string
          partidas_fechadas?: boolean | null
          status?: string
          tenant_id: string
          total_creditos?: number
          total_debitos?: number
          total_lancamentos?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          competencia_fim?: string | null
          competencia_inicio?: string | null
          contas_desconhecidas?: number
          created_at?: string
          erro_detalhe?: string | null
          filename?: string
          id?: string
          partidas_fechadas?: boolean | null
          status?: string
          tenant_id?: string
          total_creditos?: number
          total_debitos?: number
          total_lancamentos?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diario_uploads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diario_uploads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diario_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_statements: {
        Row: {
          codigo_conta: string | null
          company_id: string
          descricao: string | null
          id: string
          is_subtotal: boolean | null
          linha_ordem: number | null
          nivel: number | null
          periodo: string
          sped_file_id: string | null
          tenant_id: string
          tipo_demonstracao: string
          valor: number | null
        }
        Insert: {
          codigo_conta?: string | null
          company_id: string
          descricao?: string | null
          id?: string
          is_subtotal?: boolean | null
          linha_ordem?: number | null
          nivel?: number | null
          periodo: string
          sped_file_id?: string | null
          tenant_id: string
          tipo_demonstracao: string
          valor?: number | null
        }
        Update: {
          codigo_conta?: string | null
          company_id?: string
          descricao?: string | null
          id?: string
          is_subtotal?: boolean | null
          linha_ordem?: number | null
          nivel?: number | null
          periodo?: string
          sped_file_id?: string | null
          tenant_id?: string
          tipo_demonstracao?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_statements_sped_file_id_fkey"
            columns: ["sped_file_id"]
            isOneToOne: false
            referencedRelation: "sped_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_statements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_invoice_items: {
        Row: {
          cfop: string | null
          codigo_produto: string | null
          created_at: string
          descricao: string | null
          id: string
          invoice_id: string
          ncm: string | null
          num_item: number | null
          quantidade: number | null
          unidade: string | null
          valor_desconto: number | null
          valor_total: number | null
        }
        Insert: {
          cfop?: string | null
          codigo_produto?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          invoice_id: string
          ncm?: string | null
          num_item?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_desconto?: number | null
          valor_total?: number | null
        }
        Update: {
          cfop?: string | null
          codigo_produto?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          invoice_id?: string
          ncm?: string | null
          num_item?: number | null
          quantidade?: number | null
          unidade?: string | null
          valor_desconto?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "fiscal_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_invoices: {
        Row: {
          cancelada: boolean
          chave_nfe: string | null
          company_id: string
          created_at: string
          data_emissao: string | null
          data_entrada_saida: string | null
          id: string
          modelo: string | null
          numero: string | null
          participant_id: string | null
          serie: string | null
          sped_file_id: string | null
          tipo: string
          valor_cofins: number | null
          valor_desconto: number | null
          valor_frete: number | null
          valor_icms: number | null
          valor_icms_st: number | null
          valor_ipi: number | null
          valor_pis: number | null
          valor_produtos: number | null
          valor_total: number | null
        }
        Insert: {
          cancelada?: boolean
          chave_nfe?: string | null
          company_id: string
          created_at?: string
          data_emissao?: string | null
          data_entrada_saida?: string | null
          id?: string
          modelo?: string | null
          numero?: string | null
          participant_id?: string | null
          serie?: string | null
          sped_file_id?: string | null
          tipo: string
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_icms?: number | null
          valor_icms_st?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_total?: number | null
        }
        Update: {
          cancelada?: boolean
          chave_nfe?: string | null
          company_id?: string
          created_at?: string
          data_emissao?: string | null
          data_entrada_saida?: string | null
          id?: string
          modelo?: string | null
          numero?: string | null
          participant_id?: string | null
          serie?: string | null
          sped_file_id?: string | null
          tipo?: string
          valor_cofins?: number | null
          valor_desconto?: number | null
          valor_frete?: number | null
          valor_icms?: number | null
          valor_icms_st?: number | null
          valor_ipi?: number | null
          valor_pis?: number | null
          valor_produtos?: number | null
          valor_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_invoices_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "fiscal_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_invoices_sped_file_id_fkey"
            columns: ["sped_file_id"]
            isOneToOne: false
            referencedRelation: "sped_files"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_participants: {
        Row: {
          cnpj_cpf: string
          company_id: string
          created_at: string
          id: string
          ie: string | null
          municipio: string | null
          nome: string | null
          tipo: string | null
          uf: string | null
          updated_at: string
        }
        Insert: {
          cnpj_cpf: string
          company_id: string
          created_at?: string
          id?: string
          ie?: string | null
          municipio?: string | null
          nome?: string | null
          tipo?: string | null
          uf?: string | null
          updated_at?: string
        }
        Update: {
          cnpj_cpf?: string
          company_id?: string
          created_at?: string
          id?: string
          ie?: string | null
          municipio?: string | null
          nome?: string | null
          tipo?: string | null
          uf?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_participants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      indicador_config_empresa: {
        Row: {
          company_id: string
          contas_por_termo: Json
          created_at: string
          id: string
          indicador_key: string
          ordem: number
          tenant_id: string
          updated_at: string
          visibilidade: string
        }
        Insert: {
          company_id: string
          contas_por_termo?: Json
          created_at?: string
          id?: string
          indicador_key: string
          ordem?: number
          tenant_id: string
          updated_at?: string
          visibilidade?: string
        }
        Update: {
          company_id?: string
          contas_por_termo?: Json
          created_at?: string
          id?: string
          indicador_key?: string
          ordem?: number
          tenant_id?: string
          updated_at?: string
          visibilidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "indicador_config_empresa_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicador_config_empresa_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      indicadores_empresa: {
        Row: {
          categoria: string
          company_id: string
          created_at: string
          descricao: string | null
          faixas: Json | null
          formula: Json
          id: string
          is_padrao: boolean
          modo_analise: string
          nome: string
          ordem: number
          revisar_contas: boolean
          tenant_id: string
          updated_at: string
          visibilidade: string
        }
        Insert: {
          categoria?: string
          company_id: string
          created_at?: string
          descricao?: string | null
          faixas?: Json | null
          formula?: Json
          id?: string
          is_padrao?: boolean
          modo_analise?: string
          nome: string
          ordem?: number
          revisar_contas?: boolean
          tenant_id: string
          updated_at?: string
          visibilidade?: string
        }
        Update: {
          categoria?: string
          company_id?: string
          created_at?: string
          descricao?: string | null
          faixas?: Json | null
          formula?: Json
          id?: string
          is_padrao?: boolean
          modo_analise?: string
          nome?: string
          ordem?: number
          revisar_contas?: boolean
          tenant_id?: string
          updated_at?: string
          visibilidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "indicadores_empresa_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicadores_empresa_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      indicator_configs: {
        Row: {
          categoria: string | null
          company_id: string | null
          exibir_dashboard: boolean | null
          formato: string | null
          formula: string | null
          id: string
          meta_valor: number | null
          nome: string
          ordem: number | null
          tenant_id: string
        }
        Insert: {
          categoria?: string | null
          company_id?: string | null
          exibir_dashboard?: boolean | null
          formato?: string | null
          formula?: string | null
          id?: string
          meta_valor?: number | null
          nome: string
          ordem?: number | null
          tenant_id: string
        }
        Update: {
          categoria?: string | null
          company_id?: string | null
          exibir_dashboard?: boolean | null
          formato?: string | null
          formula?: string | null
          id?: string
          meta_valor?: number | null
          nome?: string
          ordem?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "indicator_configs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicator_configs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lancamentos_diario: {
        Row: {
          company_id: string
          competencia: string
          conta_codigo: string
          created_at: string
          credito: number
          data: string
          debito: number
          grupo_lancamento: string | null
          historico: string | null
          id: string
          lote: string | null
          numero_lancamento: string | null
          subconta_codigo: string | null
          tenant_id: string
          upload_id: string
        }
        Insert: {
          company_id: string
          competencia: string
          conta_codigo: string
          created_at?: string
          credito?: number
          data: string
          debito?: number
          grupo_lancamento?: string | null
          historico?: string | null
          id?: string
          lote?: string | null
          numero_lancamento?: string | null
          subconta_codigo?: string | null
          tenant_id: string
          upload_id: string
        }
        Update: {
          company_id?: string
          competencia?: string
          conta_codigo?: string
          created_at?: string
          credito?: number
          data?: string
          debito?: number
          grupo_lancamento?: string | null
          historico?: string | null
          id?: string
          lote?: string | null
          numero_lancamento?: string | null
          subconta_codigo?: string | null
          tenant_id?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lancamentos_diario_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_diario_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lancamentos_diario_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "diario_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      mapeamento_demonstracao: {
        Row: {
          classificacao_prefixo: string
          company_id: string | null
          created_at: string
          id: string
          inverter_sinal: boolean
          linha_demonstracao: string
          ordem: number
          tenant_id: string
          tipo_custo: string | null
          tipo_demonstracao: string
          updated_at: string
        }
        Insert: {
          classificacao_prefixo: string
          company_id?: string | null
          created_at?: string
          id?: string
          inverter_sinal?: boolean
          linha_demonstracao: string
          ordem?: number
          tenant_id: string
          tipo_custo?: string | null
          tipo_demonstracao: string
          updated_at?: string
        }
        Update: {
          classificacao_prefixo?: string
          company_id?: string | null
          created_at?: string
          id?: string
          inverter_sinal?: boolean
          linha_demonstracao?: string
          ordem?: number
          tenant_id?: string
          tipo_custo?: string | null
          tipo_demonstracao?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapeamento_demonstracao_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapeamento_demonstracao_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      mascara_classificacao: {
        Row: {
          company_id: string | null
          created_at: string
          grupos: Json
          id: string
          larguras: number[] | null
          niveis: Json
          separador: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          grupos?: Json
          id?: string
          larguras?: number[] | null
          niveis?: Json
          separador?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          grupos?: Json
          id?: string
          larguras?: number[] | null
          niveis?: Json
          separador?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mascara_classificacao_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mascara_classificacao_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_cenario_valores: {
        Row: {
          cenario_id: string
          company_id: string
          competencia: string
          created_at: string
          id: string
          item_id: string
          tenant_id: string
          updated_at: string
          valor_orcado: number
        }
        Insert: {
          cenario_id: string
          company_id: string
          competencia: string
          created_at?: string
          id?: string
          item_id: string
          tenant_id: string
          updated_at?: string
          valor_orcado?: number
        }
        Update: {
          cenario_id?: string
          company_id?: string
          competencia?: string
          created_at?: string
          id?: string
          item_id?: string
          tenant_id?: string
          updated_at?: string
          valor_orcado?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_cenario_valores_cenario_id_fkey"
            columns: ["cenario_id"]
            isOneToOne: false
            referencedRelation: "orcamento_cenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenario_valores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenario_valores_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenario_valores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_cenarios: {
        Row: {
          cenario_origem_id: string | null
          company_id: string
          created_at: string
          criado_por: string | null
          descricao: string | null
          id: string
          nome: string
          orcamento_id: string
          origem: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cenario_origem_id?: string | null
          company_id: string
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome: string
          orcamento_id: string
          origem?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cenario_origem_id?: string | null
          company_id?: string
          created_at?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          nome?: string
          orcamento_id?: string
          origem?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_cenarios_cenario_origem_id_fkey"
            columns: ["cenario_origem_id"]
            isOneToOne: false
            referencedRelation: "orcamento_cenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenarios_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenarios_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenarios_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_cenarios_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens: {
        Row: {
          company_id: string
          contas: Json
          created_at: string
          id: string
          orcamento_id: string
          ordem: number | null
          rotulo: string
          tenant_id: string
          tipo_conta: string | null
        }
        Insert: {
          company_id: string
          contas?: Json
          created_at?: string
          id?: string
          orcamento_id: string
          ordem?: number | null
          rotulo: string
          tenant_id: string
          tipo_conta?: string | null
        }
        Update: {
          company_id?: string
          contas?: Json
          created_at?: string
          id?: string
          orcamento_id?: string
          ordem?: number | null
          rotulo?: string
          tenant_id?: string
          tipo_conta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_itens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_valores: {
        Row: {
          company_id: string
          competencia: string
          created_at: string
          id: string
          item_id: string
          orcamento_id: string
          tenant_id: string
          updated_at: string
          valor_orcado: number
        }
        Insert: {
          company_id: string
          competencia: string
          created_at?: string
          id?: string
          item_id: string
          orcamento_id: string
          tenant_id: string
          updated_at?: string
          valor_orcado?: number
        }
        Update: {
          company_id?: string
          competencia?: string
          created_at?: string
          id?: string
          item_id?: string
          orcamento_id?: string
          tenant_id?: string
          updated_at?: string
          valor_orcado?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_valores_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_valores_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "orcamento_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_valores_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamento_valores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          ano: number
          company_id: string
          created_at: string
          criado_por: string | null
          id: string
          nome: string
          periodo_base_fim: string | null
          periodo_base_inicio: string | null
          realizado_visao: string
          status: string
          tenant_id: string
          tipo_base: string
          updated_at: string
        }
        Insert: {
          ano: number
          company_id: string
          created_at?: string
          criado_por?: string | null
          id?: string
          nome: string
          periodo_base_fim?: string | null
          periodo_base_inicio?: string | null
          realizado_visao?: string
          status?: string
          tenant_id: string
          tipo_base?: string
          updated_at?: string
        }
        Update: {
          ano?: number
          company_id?: string
          created_at?: string
          criado_por?: string | null
          id?: string
          nome?: string
          periodo_base_fim?: string | null
          periodo_base_inicio?: string | null
          realizado_visao?: string
          status?: string
          tenant_id?: string
          tipo_base?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_contas: {
        Row: {
          ativo: boolean
          classificacao: string
          codigo: string
          company_id: string | null
          conta_pai_classificacao: string | null
          created_at: string
          descricao: string
          id: string
          is_participante: boolean
          is_sintetica: boolean
          natureza: string
          nivel: number
          tenant_id: string
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          classificacao: string
          codigo: string
          company_id?: string | null
          conta_pai_classificacao?: string | null
          created_at?: string
          descricao: string
          id?: string
          is_participante?: boolean
          is_sintetica?: boolean
          natureza: string
          nivel?: number
          tenant_id: string
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          classificacao?: string
          codigo?: string
          company_id?: string | null
          conta_pai_classificacao?: string | null
          created_at?: string
          descricao?: string
          id?: string
          is_participante?: boolean
          is_sintetica?: boolean
          natureza?: string
          nivel?: number
          tenant_id?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          tenant_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          tenant_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saldo_inicial_uploads: {
        Row: {
          company_id: string
          created_at: string
          data_referencia: string
          diferenca: number
          encoding: string | null
          equilibrado: boolean
          erro_detalhe: string | null
          filename: string
          id: string
          status: string
          tenant_id: string
          total_ativo: number
          total_contas: number
          total_passivo_pl: number
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          data_referencia: string
          diferenca?: number
          encoding?: string | null
          equilibrado?: boolean
          erro_detalhe?: string | null
          filename: string
          id?: string
          status?: string
          tenant_id: string
          total_ativo?: number
          total_contas?: number
          total_passivo_pl?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          data_referencia?: string
          diferenca?: number
          encoding?: string | null
          equilibrado?: boolean
          erro_detalhe?: string | null
          filename?: string
          id?: string
          status?: string
          tenant_id?: string
          total_ativo?: number
          total_contas?: number
          total_passivo_pl?: number
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saldo_inicial_uploads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldo_inicial_uploads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saldos_abertura: {
        Row: {
          classificacao: string | null
          company_id: string
          conta_codigo: string
          created_at: string
          data_referencia: string
          id: string
          is_participante: boolean
          saldo: number
          tenant_id: string
          upload_id: string | null
          valor_origem: number | null
        }
        Insert: {
          classificacao?: string | null
          company_id: string
          conta_codigo: string
          created_at?: string
          data_referencia: string
          id?: string
          is_participante?: boolean
          saldo: number
          tenant_id: string
          upload_id?: string | null
          valor_origem?: number | null
        }
        Update: {
          classificacao?: string | null
          company_id?: string
          conta_codigo?: string
          created_at?: string
          data_referencia?: string
          id?: string
          is_participante?: boolean
          saldo?: number
          tenant_id?: string
          upload_id?: string | null
          valor_origem?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "saldos_abertura_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldos_abertura_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saldos_mensais: {
        Row: {
          company_id: string
          competencia: string
          conta_codigo: string
          id: string
          movimento: number | null
          tenant_id: string
          total_creditos: number
          total_debitos: number
          updated_at: string
        }
        Insert: {
          company_id: string
          competencia: string
          conta_codigo: string
          id?: string
          movimento?: number | null
          tenant_id: string
          total_creditos?: number
          total_debitos?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          competencia?: string
          conta_codigo?: string
          id?: string
          movimento?: number | null
          tenant_id?: string
          total_creditos?: number
          total_debitos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saldos_mensais_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saldos_mensais_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sped_files: {
        Row: {
          company_id: string
          competencia_fim: string | null
          competencia_inicio: string | null
          error_message: string | null
          file_url: string | null
          filename: string
          id: string
          processed_at: string | null
          status: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
          validation_results: Json | null
        }
        Insert: {
          company_id: string
          competencia_fim?: string | null
          competencia_inicio?: string | null
          error_message?: string | null
          file_url?: string | null
          filename: string
          id?: string
          processed_at?: string | null
          status?: string
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
          validation_results?: Json | null
        }
        Update: {
          company_id?: string
          competencia_fim?: string | null
          competencia_inicio?: string | null
          error_message?: string | null
          file_url?: string | null
          filename?: string
          id?: string
          processed_at?: string | null
          status?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          validation_results?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sped_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sped_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          logo_url: string | null
          max_companies: number
          max_users: number
          name: string
          plan: string
          plano_contas_modo: string
          primary_color: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          logo_url?: string | null
          max_companies?: number
          max_users?: number
          name: string
          plan?: string
          plano_contas_modo?: string
          primary_color?: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          logo_url?: string | null
          max_companies?: number
          max_users?: number
          name?: string
          plan?: string
          plano_contas_modo?: string
          primary_color?: string
          slug?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      agregar_saldos_mensais: {
        Args: { _upload_id: string }
        Returns: undefined
      }
      get_my_company_id: { Args: never; Returns: string }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_my_tenant_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      indicador_snapshot: { Args: { _company_id: string }; Returns: Json }
      is_orkestria_admin: { Args: never; Returns: boolean }
      reverter_upload_diario: {
        Args: { _upload_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "orkestria_admin" | "tenant_admin" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["orkestria_admin", "tenant_admin", "client"],
    },
  },
} as const
