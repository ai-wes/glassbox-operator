export type Cluster = "revops" | "engops";

export type UpstreamTransport =
  | {
      type: "streamable_http";
      url: string;
      headers?: Record<string, string>;
      readonly?: boolean;
    }
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };

export interface UpstreamConfig {
  id: string;
  label?: string;
  cluster: Cluster;
  /**
   * If true, Operator will allow mutating calls to this upstream
   * only when global OPERATOR_ALLOW_WRITE=1 AND confirm_write=true.
   * Read-only calls are always allowed.
   */
  allowWrite?: boolean;
  transport: UpstreamTransport;
}

export interface ActionSpec {
  upstream_id: string;
  tool: string;
  args_template: any;
  /**
   * Optional explicit classification.
   * If omitted, Operator will infer mutating by tool name heuristics.
   */
  mutating?: boolean;
}

export interface ActionMap {
  revops?: Record<string, ActionSpec>;
  engops?: Record<string, ActionSpec>;
}
