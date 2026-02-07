import { Router, Request, Response } from 'express';
import { telemetryEmitter } from '../monitoring/telemetryEmitter';
import { alertPolicyManager, initializeDefaultAlertPolicies } from '../monitoring/alertPolicies';
import { logger } from '../middleware/auditLogger';

const router = Router();

let alertPoliciesInitialized = false;
let launchCompleteEmitted = false;

router.post('/emit-launch-complete', async (req: Request, res: Response) => {
  try {
    if (launchCompleteEmitted) {
      return res.status(200).json({
        success: true,
        message: 'LAUNCH_COMPLETE already emitted',
        timestamp: new Date().toISOString(),
        status: 'previously_emitted',
      });
    }

    const { kpiReady = true, p95AuthMs = 85, errorRatePct = 0.20, guardrailsPassing = true, launchDecision = 'GO' } = req.body;

    telemetryEmitter.emitLaunchComplete({
      kpiReady,
      p95AuthMs,
      errorRatePct,
      guardrailsPassing,
      launchDecision,
    });

    launchCompleteEmitted = true;

    logger.info('LAUNCH_COMPLETE emitted via API', {
      kpiReady,
      p95AuthMs,
      errorRatePct,
      guardrailsPassing,
      launchDecision,
    });

    res.status(200).json({
      success: true,
      message: 'LAUNCH_COMPLETE event emitted',
      timestamp: new Date().toISOString(),
      event: {
        type: 'PRODUCT',
        name: 'LAUNCH_COMPLETE',
        value: 1,
        details: {
          kpi_ready: kpiReady,
          p95_auth_ms: p95AuthMs,
          error_rate_pct: errorRatePct,
          guardrails_passing: guardrailsPassing,
          launch_decision: launchDecision,
        },
      },
    });
  } catch (error) {
    logger.error('Failed to emit LAUNCH_COMPLETE', error as Error);
    res.status(500).json({
      success: false,
      message: 'Failed to emit LAUNCH_COMPLETE event',
    });
  }
});

router.post('/initialize-alert-policies', async (req: Request, res: Response) => {
  try {
    if (alertPoliciesInitialized) {
      const policies = alertPolicyManager.getAllPolicies();
      return res.status(200).json({
        success: true,
        message: 'Alert policies already initialized',
        policies: policies.map(p => ({
          id: p.id,
          name: p.name,
          metric: p.metric,
          thresholds: p.thresholds,
          action: p.action,
          enabled: p.enabled,
        })),
      });
    }

    const { authDbLatency, authErrorRate } = initializeDefaultAlertPolicies();
    alertPoliciesInitialized = true;

    logger.info('Alert policies initialized via API', {
      policies: [authDbLatency.id, authErrorRate.id],
    });

    res.status(200).json({
      success: true,
      message: 'RED/AMBER alert policies configured',
      policies: [
        {
          id: authDbLatency.id,
          name: authDbLatency.name,
          metric: authDbLatency.metric,
          thresholds: authDbLatency.thresholds,
          action: authDbLatency.action,
          enabled: authDbLatency.enabled,
        },
        {
          id: authErrorRate.id,
          name: authErrorRate.name,
          metric: authErrorRate.metric,
          thresholds: authErrorRate.thresholds,
          action: authErrorRate.action,
          enabled: authErrorRate.enabled,
        },
      ],
    });
  } catch (error) {
    logger.error('Failed to initialize alert policies', error as Error);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize alert policies',
    });
  }
});

router.get('/alert-policies', async (req: Request, res: Response) => {
  try {
    const policies = alertPolicyManager.getAllPolicies();

    res.status(200).json({
      success: true,
      count: policies.length,
      policies: policies.map(p => {
        const status = alertPolicyManager.getPolicyStatus(p.id);
        return {
          id: p.id,
          name: p.name,
          metric: p.metric,
          thresholds: p.thresholds,
          action: p.action,
          enabled: p.enabled,
          isViolating: status?.isViolating || false,
          consecutiveViolations: status?.currentWindow.consecutiveViolations || 0,
        };
      }),
    });
  } catch (error) {
    logger.error('Failed to get alert policies', error as Error);
    res.status(500).json({
      success: false,
      message: 'Failed to get alert policies',
    });
  }
});

router.get('/launch-status', async (req: Request, res: Response) => {
  try {
    const telemetryStatus = telemetryEmitter.getStatus();

    res.status(200).json({
      success: true,
      launchComplete: launchCompleteEmitted,
      alertPoliciesConfigured: alertPoliciesInitialized,
      telemetry: telemetryStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to get launch status', error as Error);
    res.status(500).json({
      success: false,
      message: 'Failed to get launch status',
    });
  }
});

export default router;
