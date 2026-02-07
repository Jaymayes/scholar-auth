/**
 * Drift Sentinel Configuration
 * CEO Executive Order SAA-EO-2026-01-19-01
 * Created: 2026-01-19
 * 
 * A8 Watchtower to record workspace_id, commit_sha, manifest_digest, build_artifact_sha
 */

export interface DriftSentinelConfig {
  enabled: boolean;
  watchtowerApp: string;
  trackedFields: string[];
  alertRules: AlertRules;
}

export interface AlertRules {
  manifestMismatch: {
    action: 'auto_block_publish' | 'alert_only';
    notify: 'on_call' | 'channel';
  };
  endpointRegression: {
    threshold5xx: number;
    threshold404: number;
    durationMinutes: number;
    action: 'disable_b2c_capture' | 'alert_only';
    keepRefunds: boolean;
    openCir: boolean;
  };
}

export interface DeploymentDigest {
  workspace_id: string;
  commit_sha: string;
  manifest_digest: string;
  build_artifact_sha: string;
  recorded_at: string;
  app_id: string;
  verified: boolean;
}

export interface RegressionAlert {
  id: string;
  app_id: string;
  alert_type: 'manifest_mismatch' | 'endpoint_regression';
  details: Record<string, unknown>;
  action_taken: string;
  cir_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

export const driftSentinelConfig: DriftSentinelConfig = {
  enabled: process.env.FF_DRIFT_SENTINEL !== 'false',
  watchtowerApp: 'A8_auto_com_center',
  trackedFields: ['workspace_id', 'commit_sha', 'manifest_digest', 'build_artifact_sha'],
  alertRules: {
    manifestMismatch: {
      action: 'auto_block_publish',
      notify: 'on_call',
    },
    endpointRegression: {
      threshold5xx: 0.02,
      threshold404: 0.02,
      durationMinutes: 10,
      action: 'disable_b2c_capture',
      keepRefunds: true,
      openCir: true,
    },
  },
};

export function createDeploymentDigest(params: {
  workspace_id: string;
  commit_sha: string;
  manifest_digest: string;
  build_artifact_sha: string;
  app_id: string;
}): DeploymentDigest {
  return {
    ...params,
    recorded_at: new Date().toISOString(),
    verified: false,
  };
}

export function checkManifestMatch(
  manifest_digest: string,
  build_artifact_sha: string
): boolean {
  return manifest_digest === build_artifact_sha;
}

export function shouldBlockPublish(
  manifest_digest: string,
  build_artifact_sha: string
): boolean {
  if (!driftSentinelConfig.enabled) return false;
  if (driftSentinelConfig.alertRules.manifestMismatch.action !== 'auto_block_publish') return false;
  return !checkManifestMatch(manifest_digest, build_artifact_sha);
}

export function shouldDisableB2CCapture(
  errorRate5xx: number,
  errorRate404: number
): boolean {
  if (!driftSentinelConfig.enabled) return false;
  const rules = driftSentinelConfig.alertRules.endpointRegression;
  return errorRate5xx >= rules.threshold5xx || errorRate404 >= rules.threshold404;
}

export function generateCirId(): string {
  return `CIR-${Date.now().toString(36).toUpperCase()}`;
}

export function createRegressionAlert(params: {
  app_id: string;
  alert_type: 'manifest_mismatch' | 'endpoint_regression';
  details: Record<string, unknown>;
  action_taken: string;
}): RegressionAlert {
  return {
    id: `alert_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    ...params,
    cir_id: params.alert_type === 'endpoint_regression' ? generateCirId() : null,
    created_at: new Date().toISOString(),
    resolved_at: null,
  };
}

export default driftSentinelConfig;
