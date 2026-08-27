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
    PostgrestVersion: "14.17"
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
      backup_alocacao_removida: {
        Row: {
          classificacao: string | null
          codigo: string | null
          company_id: string | null
          descricao: string | null
          id: string | null
          inverter_sinal: boolean | null
          linha_demonstracao: string | null
          ordem_linha: number | null
          tenant_id: string | null
          tipo_demonstracao: string | null
        }
        Insert: {
          classificacao?: string | null
          codigo?: string | null
          company_id?: string | null
          descricao?: string | null
          id?: string | null
          inverter_sinal?: boolean | null
          linha_demonstracao?: string | null
          ordem_linha?: number | null
          tenant_id?: string | null
          tipo_demonstracao?: string | null
        }
        Update: {
          classificacao?: string | null
          codigo?: string | null
          company_id?: string | null
          descricao?: string | null
          id?: string | null
          inverter_sinal?: boolean | null
          linha_demonstracao?: string | null
          ordem_linha?: number | null
          tenant_id?: string | null
          tipo_demonstracao?: string | null
        }
        Relationships: []
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
          bairro: string | null
          cep: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string
          email: string | null
          fonte_dados: string
          id: string
          logradouro: string | null
          municipio: string | null
          name: string
          numero: string | null
          plano_tipo: string
          razao_social: string | null
          regime_tributario: string | null
          responsavel: string | null
          telefone: string | null
          tenant_id: string
          uf: string | null
        }
        Insert: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          fonte_dados?: string
          id?: string
          logradouro?: string | null
          municipio?: string | null
          name: string
          numero?: string | null
          plano_tipo?: string
          razao_social?: string | null
          regime_tributario?: string | null
          responsavel?: string | null
          telefone?: string | null
          tenant_id: string
          uf?: string | null
        }
        Update: {
          ativo?: boolean
          bairro?: string | null
          cep?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          fonte_dados?: string
          id?: string
          logradouro?: string | null
          municipio?: string | null
          name?: string
          numero?: string | null
          plano_tipo?: string
          razao_social?: string | null
          regime_tributario?: string | null
          responsavel?: string | null
          telefone?: string | null
          tenant_id?: string
          uf?: string | null
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
          company_id: string | null
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
          company_id?: string | null
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
          company_id?: string | null
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
      depara_contas: {
        Row: {
          company_id: string
          conta_codigo: string
          conta_padrao_codigo: string | null
          created_at: string
          id: string
          ignorada: boolean
          observacao: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          conta_codigo: string
          conta_padrao_codigo?: string | null
          created_at?: string
          id?: string
          ignorada?: boolean
          observacao?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          conta_codigo?: string
          conta_padrao_codigo?: string | null
          created_at?: string
          id?: string
          ignorada?: boolean
          observacao?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "depara_contas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depara_contas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      depara_regras: {
        Row: {
          classificacao_prefixo: string | null
          company_id: string
          conta_padrao_codigo: string
          created_at: string
          id: string
          observacao: string | null
          tenant_id: string
          tipo_conta: string | null
        }
        Insert: {
          classificacao_prefixo?: string | null
          company_id: string
          conta_padrao_codigo: string
          created_at?: string
          id?: string
          observacao?: string | null
          tenant_id: string
          tipo_conta?: string | null
        }
        Update: {
          classificacao_prefixo?: string | null
          company_id?: string
          conta_padrao_codigo?: string
          created_at?: string
          id?: string
          observacao?: string | null
          tenant_id?: string
          tipo_conta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depara_regras_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depara_regras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_catalogo: {
        Row: {
          bloco: string
          codigo: string
          descricao: string
          ordem: number
        }
        Insert: {
          bloco: string
          codigo: string
          descricao: string
          ordem: number
        }
        Update: {
          bloco?: string
          codigo?: string
          descricao?: string
          ordem?: number
        }
        Relationships: []
      }
      dfc_config: {
        Row: {
          company_id: string
          conta_caixa: Json
          created_at: string
          id: string
          metodo_padrao: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          conta_caixa?: Json
          created_at?: string
          id?: string
          metodo_padrao?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          conta_caixa?: Json
          created_at?: string
          id?: string
          metodo_padrao?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfc_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dfc_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_linha_contas: {
        Row: {
          company_id: string
          contas: Json
          created_at: string
          id: string
          linha: string
          metodo: string
          operacao: string
          ordem: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          contas?: Json
          created_at?: string
          id?: string
          linha: string
          metodo: string
          operacao?: string
          ordem?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          contas?: Json
          created_at?: string
          id?: string
          linha?: string
          metodo?: string
          operacao?: string
          ordem?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dfc_linha_contas_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dfc_linha_contas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dfc_padrao: {
        Row: {
          classificacao: string
          codigo_dfc: string
          descricao_referencia: string | null
        }
        Insert: {
          classificacao: string
          codigo_dfc: string
          descricao_referencia?: string | null
        }
        Update: {
          classificacao?: string
          codigo_dfc?: string
          descricao_referencia?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dfc_padrao_codigo_dfc_fkey"
            columns: ["codigo_dfc"]
            isOneToOne: false
            referencedRelation: "dfc_catalogo"
            referencedColumns: ["codigo"]
          },
        ]
      }
      diario_uploads: {
        Row: {
          agregado: boolean
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
          agregado?: boolean
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
          agregado?: boolean
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
      dre_linhas_config: {
        Row: {
          ebit_classificacoes: string[]
          ebit_expressao: Json
          ebitda_classificacoes: string[]
          ebitda_expressao: Json
          ebitda_sobre_ebit: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ebit_classificacoes?: string[]
          ebit_expressao?: Json
          ebitda_classificacoes?: string[]
          ebitda_expressao?: Json
          ebitda_sobre_ebit?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ebit_classificacoes?: string[]
          ebit_expressao?: Json
          ebitda_classificacoes?: string[]
          ebitda_expressao?: Json
          ebitda_sobre_ebit?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dre_linhas_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ecd_conta: {
        Row: {
          caminho_codigos: string | null
          caminho_nomes: string | null
          classificacao: string | null
          classificacao_origem: string | null
          cod_aglutinacao: string | null
          cod_referencial: string | null
          cod_superior: string | null
          codigo: string
          descricao: string | null
          importacao_id: string
          natureza: string | null
          nivel: number | null
          profundidade: number | null
          tipo: string | null
        }
        Insert: {
          caminho_codigos?: string | null
          caminho_nomes?: string | null
          classificacao?: string | null
          classificacao_origem?: string | null
          cod_aglutinacao?: string | null
          cod_referencial?: string | null
          cod_superior?: string | null
          codigo: string
          descricao?: string | null
          importacao_id: string
          natureza?: string | null
          nivel?: number | null
          profundidade?: number | null
          tipo?: string | null
        }
        Update: {
          caminho_codigos?: string | null
          caminho_nomes?: string | null
          classificacao?: string | null
          classificacao_origem?: string | null
          cod_aglutinacao?: string | null
          cod_referencial?: string | null
          cod_superior?: string | null
          codigo?: string
          descricao?: string | null
          importacao_id?: string
          natureza?: string | null
          nivel?: number | null
          profundidade?: number | null
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecd_conta_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "ecd_importacao"
            referencedColumns: ["id"]
          },
        ]
      }
      ecd_importacao: {
        Row: {
          aplicado_em: string | null
          arquivo_nome: string
          cnpj: string | null
          company_id: string
          criado_em: string
          id: string
          periodo_fim: string | null
          periodo_inicio: string | null
          razao_social: string | null
          resumo: Json
          status: string
          tenant_id: string
        }
        Insert: {
          aplicado_em?: string | null
          arquivo_nome: string
          cnpj?: string | null
          company_id: string
          criado_em?: string
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          razao_social?: string | null
          resumo?: Json
          status?: string
          tenant_id: string
        }
        Update: {
          aplicado_em?: string | null
          arquivo_nome?: string
          cnpj?: string | null
          company_id?: string
          criado_em?: string
          id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          razao_social?: string | null
          resumo?: Json
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecd_importacao_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecd_importacao_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ecd_lancamento: {
        Row: {
          codigo: string
          competencia: string
          credito: number
          data: string
          debito: number
          historico: string | null
          importacao_id: string
          numero: string | null
          seq: number
        }
        Insert: {
          codigo: string
          competencia: string
          credito?: number
          data: string
          debito?: number
          historico?: string | null
          importacao_id: string
          numero?: string | null
          seq?: number
        }
        Update: {
          codigo?: string
          competencia?: string
          credito?: number
          data?: string
          debito?: number
          historico?: string | null
          importacao_id?: string
          numero?: string | null
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "ecd_lancamento_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "ecd_importacao"
            referencedColumns: ["id"]
          },
        ]
      }
      ecd_saldo: {
        Row: {
          codigo: string
          competencia: string
          creditos: number
          debitos: number
          importacao_id: string
          saldo_final: number
          saldo_inicial: number
        }
        Insert: {
          codigo: string
          competencia: string
          creditos?: number
          debitos?: number
          importacao_id: string
          saldo_final?: number
          saldo_inicial?: number
        }
        Update: {
          codigo?: string
          competencia?: string
          creditos?: number
          debitos?: number
          importacao_id?: string
          saldo_final?: number
          saldo_inicial?: number
        }
        Relationships: [
          {
            foreignKeyName: "ecd_saldo_importacao_id_fkey"
            columns: ["importacao_id"]
            isOneToOne: false
            referencedRelation: "ecd_importacao"
            referencedColumns: ["id"]
          },
        ]
      }
      estrutura_padrao: {
        Row: {
          classificacao: string
          demonstracao: string | null
          ordem: number
          papel: string
          rotulo: string | null
          tipo_linha: string
        }
        Insert: {
          classificacao: string
          demonstracao?: string | null
          ordem?: number
          papel: string
          rotulo?: string | null
          tipo_linha: string
        }
        Update: {
          classificacao?: string
          demonstracao?: string | null
          ordem?: number
          papel?: string
          rotulo?: string | null
          tipo_linha?: string
        }
        Relationships: []
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
      indicador_alocacao: {
        Row: {
          company_id: string
          indicador_id: string
          ordem: number | null
          tenant_id: string
          updated_at: string
          visibilidade: string
        }
        Insert: {
          company_id: string
          indicador_id: string
          ordem?: number | null
          tenant_id: string
          updated_at?: string
          visibilidade?: string
        }
        Update: {
          company_id?: string
          indicador_id?: string
          ordem?: number | null
          tenant_id?: string
          updated_at?: string
          visibilidade?: string
        }
        Relationships: [
          {
            foreignKeyName: "indicador_alocacao_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicador_alocacao_indicador_id_fkey"
            columns: ["indicador_id"]
            isOneToOne: false
            referencedRelation: "indicadores_empresa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indicador_alocacao_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          company_id: string | null
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
          company_id?: string | null
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
          company_id?: string | null
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
          conta_nome: string | null
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
          conta_nome?: string | null
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
          conta_nome?: string | null
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
      plano_atualizacoes: {
        Row: {
          atualizadas: number
          company_id: string | null
          created_at: string
          executado_por: string | null
          filename: string | null
          id: string
          inalteradas: number
          novas: number
          tenant_id: string
          total_arquivo: number
        }
        Insert: {
          atualizadas?: number
          company_id?: string | null
          created_at?: string
          executado_por?: string | null
          filename?: string | null
          id?: string
          inalteradas?: number
          novas?: number
          tenant_id: string
          total_arquivo?: number
        }
        Update: {
          atualizadas?: number
          company_id?: string | null
          created_at?: string
          executado_por?: string | null
          filename?: string | null
          id?: string
          inalteradas?: number
          novas?: number
          tenant_id?: string
          total_arquivo?: number
        }
        Relationships: [
          {
            foreignKeyName: "plano_atualizacoes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_atualizacoes_executado_por_fkey"
            columns: ["executado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_atualizacoes_tenant_id_fkey"
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
          dfc_atividade: string | null
          dfc_codigo: string | null
          dfc_nao_caixa: boolean
          id: string
          is_participante: boolean
          is_sintetica: boolean
          natureza: string
          nivel: number
          tenant_id: string
          tipo: string
          tipo_custo: string | null
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
          dfc_atividade?: string | null
          dfc_codigo?: string | null
          dfc_nao_caixa?: boolean
          id?: string
          is_participante?: boolean
          is_sintetica?: boolean
          natureza: string
          nivel?: number
          tenant_id: string
          tipo: string
          tipo_custo?: string | null
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
          dfc_atividade?: string | null
          dfc_codigo?: string | null
          dfc_nao_caixa?: boolean
          id?: string
          is_participante?: boolean
          is_sintetica?: boolean
          natureza?: string
          nivel?: number
          tenant_id?: string
          tipo?: string
          tipo_custo?: string | null
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
            foreignKeyName: "plano_contas_dfc_codigo_fkey"
            columns: ["dfc_codigo"]
            isOneToOne: false
            referencedRelation: "dfc_catalogo"
            referencedColumns: ["codigo"]
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
      plano_contas_descartadas: {
        Row: {
          codigo: string
          created_at: string
          descartado_por: string | null
          id: string
          motivo: string | null
          tenant_id: string
        }
        Insert: {
          codigo: string
          created_at?: string
          descartado_por?: string | null
          id?: string
          motivo?: string | null
          tenant_id: string
        }
        Update: {
          codigo?: string
          created_at?: string
          descartado_por?: string | null
          id?: string
          motivo?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plano_contas_descartadas_descartado_por_fkey"
            columns: ["descartado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plano_contas_descartadas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plano_padrao_referencia: {
        Row: {
          classificacao: string
          codigo: string
          conta_pai_classificacao: string | null
          descricao: string
          natureza: string
          nivel: number
          tipo: string
        }
        Insert: {
          classificacao: string
          codigo: string
          conta_pai_classificacao?: string | null
          descricao: string
          natureza: string
          nivel: number
          tipo: string
        }
        Update: {
          classificacao?: string
          codigo?: string
          conta_pai_classificacao?: string | null
          descricao?: string
          natureza?: string
          nivel?: number
          tipo?: string
        }
        Relationships: []
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
      __apply_pending_sql: { Args: { _sql: string }; Returns: undefined }
      _num: { Args: { _v: number }; Returns: Json }
      _op: { Args: { _v: string }; Returns: Json }
      _par: { Args: { _v: string }; Returns: Json }
      _termo: { Args: { _linha: string }; Returns: Json }
      agregar_saldos_mensais: {
        Args: { _upload_id: string }
        Returns: undefined
      }
      aplicar_depara_em_lote: {
        Args: { _company_id: string; _itens: Json }
        Returns: Json
      }
      aplicar_dfc_padrao: {
        Args: {
          _company_id?: string
          _sobrescrever?: boolean
          _tenant_id: string
        }
        Returns: Json
      }
      aprovar_contas_novas: {
        Args: { _itens: Json; _tenant_id: string }
        Returns: Json
      }
      aprovar_contas_novas_lote: {
        Args: { _itens: Json; _tenant_id: string }
        Returns: Json
      }
      atualizar_plano_padrao: {
        Args: { _company_id: string; _rows: Json; _tenant_id: string }
        Returns: Json
      }
      contas_novas_do_diario: {
        Args: { _limite?: number; _tenant_id: string }
        Returns: {
          codigo: string
          empresas: string
          historico_exemplo: string
          lancamentos: number
          movimento: number
          nome_sugerido: string
          primeira_competencia: string
          ultima_competencia: string
        }[]
      }
      depara_pendencias: {
        Args: { _company_id: string; _limite?: number }
        Returns: {
          classificacao: string
          codigo: string
          descricao: string
          movimento: number
          sugestao_codigo: string
          sugestao_descricao: string
          tipo: string
        }[]
      }
      depara_traducao: {
        Args: { _company_id: string }
        Returns: {
          conta_codigo: string
          conta_padrao_codigo: string
          ignorada: boolean
          origem: string
        }[]
      }
      descartar_contas_novas: {
        Args: { _codigos: string[]; _motivo?: string; _tenant_id: string }
        Returns: Json
      }
      drilldown_contas: {
        Args: {
          _classificacao: string
          _company_id: string
          _competencia_max?: string
          _competencia_min?: string
        }
        Returns: {
          classificacao: string
          codigo: string
          descricao: string
        }[]
      }
      ecd_alocar_automatico: {
        Args: { _importacao_id: string; _refazer?: boolean }
        Returns: Json
      }
      ecd_alocar_por_grupo: {
        Args: {
          _importacao_id: string
          _minimo?: number
          _so_conferir?: boolean
        }
        Returns: Json
      }
      ecd_aplicar: {
        Args: {
          _forcar?: boolean
          _importacao_id: string
          _substituir?: boolean
        }
        Returns: Json
      }
      ecd_classificar: { Args: { _importacao_id: string }; Returns: number }
      ecd_conferencia: { Args: { _importacao_id: string }; Returns: Json }
      ecd_conferir_natureza: {
        Args: { _importacao_id: string }
        Returns: {
          cod_nat: string
          conta_codigo: string
          conta_nome: string
          destino_cls: string
          destino_codigo: string
          destino_nome: string
          destino_tipo: string
          movimento: number
          natureza_nome: string
          observacao: string
          tipo_esperado: string
        }[]
      }
      ecd_contar_automaticas: {
        Args: { _importacao_id: string }
        Returns: number
      }
      ecd_desfazer: { Args: { _importacao_id: string }; Returns: Json }
      ecd_diagnostico: {
        Args: { _importacao_id: string; _limite?: number }
        Returns: Json
      }
      ecd_encerramento: { Args: { _importacao_id: string }; Returns: Json }
      ecd_forma: { Args: { _importacao_id: string }; Returns: Json }
      ecd_gravar_lancamentos: {
        Args: {
          _importacao_id: string
          _linhas: Json
          _primeiro_bloco?: boolean
        }
        Returns: Json
      }
      ecd_gravar_referencias: {
        Args: { _importacao_id: string; _refs: Json }
        Returns: Json
      }
      ecd_grupo_destino: {
        Args: { _importacao_id: string }
        Returns: {
          cod_nat: string
          codigo: string
          descricao: string
          galho_no_arquivo: string
          grupo_classificacao: string
          grupo_descricao: string
          nota: number
          tipo_alvo: string
        }[]
      }
      ecd_importar: {
        Args: {
          _arquivo_nome: string
          _cabecalho: Json
          _company_id: string
          _contas: Json
          _saldos: Json
        }
        Returns: Json
      }
      ecd_materializar_lancamentos: {
        Args: { _importacao_id: string }
        Returns: Json
      }
      ecd_normalizar_texto: { Args: { _s: string }; Returns: string }
      ecd_palavras: { Args: { _s: string }; Returns: string[] }
      ecd_resumo_natureza: { Args: { _importacao_id: string }; Returns: Json }
      ecd_similaridade: { Args: { _a: string; _b: string }; Returns: number }
      ecd_sugerir_depara: {
        Args: { _importacao_id: string; _refazer?: boolean }
        Returns: Json
      }
      ecd_tipo_do_cod_nat: { Args: { _cod_nat: string }; Returns: string }
      ecd_vinculo_do_robo: { Args: { _observacao: string }; Returns: boolean }
      escopo_plano_empresa: { Args: { _company_id: string }; Returns: Json }
      finalizar_upload_diario: { Args: { _upload_id: string }; Returns: Json }
      garantir_contas_agregadoras: {
        Args: { _tenant_id: string }
        Returns: Json
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
      indicador_alocar: {
        Args: { _company_id: string; _itens: Json }
        Returns: Json
      }
      indicador_consolidar: { Args: { _simular?: boolean }; Returns: Json }
      indicador_snapshot: { Args: { _company_id: string }; Returns: Json }
      indicadores_da_empresa: {
        Args: { _company_id: string }
        Returns: {
          alocado: boolean
          categoria: string
          descricao: string
          escopo: string
          faixas: Json
          formula: Json
          id: string
          is_padrao: boolean
          modo_analise: string
          nome: string
          ordem: number
          revisar_contas: boolean
          visibilidade: string
        }[]
      }
      is_orkestria_admin: { Args: never; Returns: boolean }
      plano_cobertura: { Args: { _company_id: string }; Returns: Json }
      plano_escopo: {
        Args: { _company_id: string }
        Returns: {
          company_scope: string
          separador: string
          tenant_id: string
        }[]
      }
      plano_padrao_resumo: { Args: { _tenant_id: string }; Returns: Json }
      pode_acessar_empresa: { Args: { _company_id: string }; Returns: boolean }
      pode_gerenciar_tenant: { Args: { _tenant_id: string }; Returns: boolean }
      promover_plano_empresa: { Args: { _company_id: string }; Returns: Json }
      restaurar_conta_descartada: {
        Args: { _codigo: string; _tenant_id: string }
        Returns: Json
      }
      reverter_upload_diario: {
        Args: { _upload_id: string }
        Returns: undefined
      }
      revincular_dfc: {
        Args: {
          _company_id?: string
          _tenant_id: string
          _todos_escopos?: boolean
        }
        Returns: Json
      }
      semear_dfc_padrao: { Args: { _tenant_id?: string }; Returns: Json }
      semear_indicadores_padrao: {
        Args: { _company_id: string; _substituir?: boolean }
        Returns: Json
      }
      semear_plano_padrao: {
        Args: { _substituir?: boolean; _tenant_id: string }
        Returns: Json
      }
      similarity_simples: { Args: { _a: string; _b: string }; Returns: number }
      sinteticas_do_plano_padrao: {
        Args: { _tenant_id: string }
        Returns: {
          classificacao: string
          codigo: string
          descricao: string
          filhos: number
          tipo: string
        }[]
      }
      unaccent_simples: { Args: { _s: string }; Returns: string }
      uploads_incompletos: {
        Args: { _company_id: string }
        Returns: {
          criado_em: string
          filename: string
          id: string
          lancamentos_esperados: number
          lancamentos_gravados: number
          status: string
        }[]
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
