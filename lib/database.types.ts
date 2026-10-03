
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "areas": {
                  Row: {
                    "district_th": string,"geom": unknown,"level": string,"name_en": string | null,"name_th": string
                  }
                  Insert: {
                    "district_th": string,"geom": unknown,"level": string,"name_en"?: string | null,"name_th": string
                  }
                  Update: {
                    "district_th"?: string,"geom"?: unknown,"level"?: string,"name_en"?: string | null,"name_th"?: string
                  }
                  Relationships: [
                    
                  ]
                },"flood_reports": {
                  Row: {
                    "district": string | null,"finished_at": string | null,"geom": unknown,"ingested_at": string,"reported_at": string,"source": string,"source_id": string,"state": string | null,"subdistrict": string | null
                  }
                  Insert: {
                    "district"?: string | null,"finished_at"?: string | null,"geom": unknown,"ingested_at"?: string,"reported_at": string,"source"?: string,"source_id": string,"state"?: string | null,"subdistrict"?: string | null
                  }
                  Update: {
                    "district"?: string | null,"finished_at"?: string | null,"geom"?: unknown,"ingested_at"?: string,"reported_at"?: string,"source"?: string,"source_id"?: string,"state"?: string | null,"subdistrict"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"ingest_runs": {
                  Row: {
                    "error": string | null,"finished_at": string | null,"id": number,"rows_rejected": number | null,"rows_upserted": number | null,"source": string,"started_at": string,"status": string,"window_end": string | null,"window_start": string | null
                  }
                  Insert: {
                    "error"?: string | null,"finished_at"?: string | null,"id"?: never,"rows_rejected"?: number | null,"rows_upserted"?: number | null,"source": string,"started_at"?: string,"status": string,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Update: {
                    "error"?: string | null,"finished_at"?: string | null,"id"?: never,"rows_rejected"?: number | null,"rows_upserted"?: number | null,"source"?: string,"started_at"?: string,"status"?: string,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"score_reference": {
                  Row: {
                    "grid_point": unknown,"score_version": number,"weighted_count": number
                  }
                  Insert: {
                    "grid_point": unknown,"score_version": number,"weighted_count": number
                  }
                  Update: {
                    "grid_point"?: unknown,"score_version"?: number,"weighted_count"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "district_ranking":
{ Args: Record<PropertyKey, never>; Returns: {
              "district": string,"rank": number,"reports_this_year": number,"weighted_count": number
            }[]
                           },
"flood_area_v1":
{ Args: { "district_name": string,"subdistrict_name"?: string }; Returns: Json
                           },
"flood_overview_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"flood_points_v1":
{ Args: { "lat": number,"lng": number,"radius_m"?: number }; Returns: {
              "report_lat": number,"report_lng": number,"reported_at": string,"state": string
            }[]
                           },
"flood_score_v1":
{ Args: { "lat": number,"lng": number }; Returns: Json
                           },
"flood_status_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"in_bangkok":
{ Args: { "lat": number,"lng": number }; Returns: boolean
                           },
"load_areas":
{ Args: { "payload": Json }; Returns: undefined
                           },
"refresh_score_reference":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"report_weight":
{ Args: { "reported_at": string }; Returns: number
                           },
"weighted_count_at":
{ Args: { "p": unknown }; Returns: number
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
