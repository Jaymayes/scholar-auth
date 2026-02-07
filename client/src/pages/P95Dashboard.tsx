import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart, ComposedChart, Bar } from 'recharts';
import { AlertTriangle, CheckCircle2, XCircle, Activity, TrendingUp, TrendingDown, Minus, Clock, Zap, Database, Shield, Gauge } from 'lucide-react';

interface MetricPoint {
  timestamp: number;
  value: number;
}

interface TrendData {
  timestamp: string;
  windows: {
    fifteen_min_1min_res: {
      a6_provider_register: MetricPoint[];
      a6_health: MetricPoint[];
      a3_to_a6_call: MetricPoint[];
    };
    ten_min_10sec_res: {
      a6_provider_register: MetricPoint[];
      a6_health: MetricPoint[];
      a3_to_a6_call: MetricPoint[];
    };
  };
  series: {
    a6_provider_register: MetricPoint[];
    a6_health: MetricPoint[];
    a3_to_a6_call: MetricPoint[];
  };
  overlays: {
    error_rate: MetricPoint[];
    throttle_state: MetricPoint[];
    autoscaling_reserves: MetricPoint[];
    cache_hit_pct: MetricPoint[];
    backlog_depth: MetricPoint[];
  };
  annotations: Array<{
    timestamp: number;
    type: string;
    label: string;
  }>;
  callouts: {
    current_p95: number;
    five_min_slope: number;
    ten_min_trendline: number;
    gate_threshold: number;
    recommendation: 'GO' | 'THROTTLE' | 'KILL';
  };
  decision: {
    status: 'GREEN' | 'YELLOW' | 'RED' | 'CRITICAL';
    action: string;
    should_page: boolean;
  };
}

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
    hour12: false 
  });
};

const StatusBadge = ({ status }: { status: string }) => {
  const variants: Record<string, { variant: 'default' | 'destructive' | 'outline' | 'secondary'; icon: JSX.Element; className: string }> = {
    GREEN: { variant: 'default', icon: <CheckCircle2 className="w-4 h-4" />, className: 'bg-green-500 hover:bg-green-600' },
    YELLOW: { variant: 'secondary', icon: <AlertTriangle className="w-4 h-4" />, className: 'bg-yellow-500 hover:bg-yellow-600 text-black' },
    RED: { variant: 'destructive', icon: <XCircle className="w-4 h-4" />, className: 'bg-red-500 hover:bg-red-600' },
    CRITICAL: { variant: 'destructive', icon: <XCircle className="w-4 h-4" />, className: 'bg-red-700 hover:bg-red-800 animate-pulse' }
  };
  
  const config = variants[status] || variants.YELLOW;
  
  return (
    <Badge className={`flex items-center gap-1 ${config.className}`}>
      {config.icon}
      {status}
    </Badge>
  );
};

const RecommendationBadge = ({ recommendation }: { recommendation: string }) => {
  const variants: Record<string, { className: string; icon: JSX.Element }> = {
    GO: { className: 'bg-green-600 text-white', icon: <CheckCircle2 className="w-4 h-4" /> },
    THROTTLE: { className: 'bg-yellow-500 text-black', icon: <AlertTriangle className="w-4 h-4" /> },
    KILL: { className: 'bg-red-700 text-white animate-pulse', icon: <XCircle className="w-4 h-4" /> }
  };
  
  const config = variants[recommendation] || variants.THROTTLE;
  
  return (
    <Badge className={`flex items-center gap-1 text-lg px-4 py-2 ${config.className}`}>
      {config.icon}
      {recommendation}
    </Badge>
  );
};

const SlopeIndicator = ({ slope }: { slope: number }) => {
  if (slope < -5) return <TrendingDown className="w-5 h-5 text-green-500" />;
  if (slope > 5) return <TrendingUp className="w-5 h-5 text-red-500" />;
  return <Minus className="w-5 h-5 text-yellow-500" />;
};

export default function P95Dashboard() {
  const [lastPaged, setLastPaged] = useState<number>(0);
  
  const { data, isLoading, error } = useQuery<TrendData>({
    queryKey: ['/api/p95/live'],
    refetchInterval: 5000
  });
  
  useEffect(() => {
    if (data?.decision?.should_page && Date.now() - lastPaged > 60000) {
      console.error('🚨 PAGING ALERT:', data.decision.action);
      setLastPaged(Date.now());
    }
  }, [data?.decision?.should_page, lastPaged]);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }
  
  if (error || !data) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Failed to fetch P95 metrics</AlertDescription>
      </Alert>
    );
  }
  
  const chartData = data.series.a6_provider_register.map((point, i) => ({
    time: formatTime(point.timestamp),
    timestamp: point.timestamp,
    a6_provider_register: point.value,
    a6_health: data.series.a6_health[i]?.value || 0,
    a3_to_a6_call: data.series.a3_to_a6_call[i]?.value || 0,
    error_rate: data.overlays.error_rate[i]?.value || 0,
    backlog_depth: data.overlays.backlog_depth[i]?.value || 0,
    cache_hit_pct: data.overlays.cache_hit_pct[i]?.value || 0,
    autoscaling_reserves: data.overlays.autoscaling_reserves[i]?.value || 0
  }));
  
  const overlayData = data.overlays.error_rate.map((point, i) => ({
    time: formatTime(point.timestamp),
    error_rate: point.value,
    throttle_state: data.overlays.throttle_state[i]?.value || 0,
    autoscaling_reserves: data.overlays.autoscaling_reserves[i]?.value || 0,
    cache_hit_pct: data.overlays.cache_hit_pct[i]?.value || 0,
    backlog_depth: data.overlays.backlog_depth[i]?.value || 0
  }));
  
  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Activity className="w-8 h-8 text-blue-400" />
            <h1 className="text-2xl font-bold">P95 Live Trend Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">Last update: {data.timestamp}</span>
            <StatusBadge status={data.decision.status} />
            <RecommendationBadge recommendation={data.callouts.recommendation} />
          </div>
        </div>
        
        {data.decision.should_page && (
          <Alert variant="destructive" className="border-red-700 bg-red-950 animate-pulse">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="text-lg font-bold">THRESHOLD BREACH - PAGING</AlertTitle>
            <AlertDescription className="text-lg">{data.decision.action}</AlertDescription>
          </Alert>
        )}
        
        <div className="grid grid-cols-5 gap-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                <Gauge className="w-4 h-4" />
                Current P95
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${data.callouts.current_p95 > data.callouts.gate_threshold ? 'text-red-500' : 'text-green-500'}`}>
                {data.callouts.current_p95}ms
              </div>
              <div className="text-xs text-slate-500">Gate: {data.callouts.gate_threshold}ms</div>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                <SlopeIndicator slope={data.callouts.five_min_slope} />
                5-min Slope
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${data.callouts.five_min_slope < 0 ? 'text-green-500' : data.callouts.five_min_slope > 0 ? 'text-red-500' : 'text-yellow-500'}`}>
                {data.callouts.five_min_slope > 0 ? '+' : ''}{data.callouts.five_min_slope.toFixed(2)}
              </div>
              <div className="text-xs text-slate-500">ms/min trend</div>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                10-min Trendline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${data.callouts.ten_min_trendline > data.callouts.gate_threshold ? 'text-red-500' : 'text-green-500'}`}>
                {data.callouts.ten_min_trendline}ms
              </div>
              <div className="text-xs text-slate-500">vs {data.callouts.gate_threshold}ms gate</div>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Error Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${overlayData.length > 0 && overlayData[overlayData.length - 1]?.error_rate > 0.5 ? 'text-red-500' : 'text-green-500'}`}>
                {overlayData.length > 0 ? overlayData[overlayData.length - 1]?.error_rate.toFixed(2) : 0}%
              </div>
              <div className="text-xs text-slate-500">Gate: 0.5%</div>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
                <Database className="w-4 h-4" />
                Backlog Depth
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${overlayData.length > 0 && overlayData[overlayData.length - 1]?.backlog_depth > 10 ? 'text-red-500' : 'text-green-500'}`}>
                {overlayData.length > 0 ? overlayData[overlayData.length - 1]?.backlog_depth : 0}
              </div>
              <div className="text-xs text-slate-500">Gate: &lt;10</div>
            </CardContent>
          </Card>
        </div>
        
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              P95 Latency (10-min @ 10-sec resolution)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" domain={[0, 2000]} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                  labelStyle={{ color: '#e2e8f0' }}
                />
                <Legend />
                <ReferenceLine y={1250} stroke="#ef4444" strokeDasharray="5 5" label={{ value: '1.25s Gate', fill: '#ef4444', fontSize: 10 }} />
                <ReferenceLine y={1000} stroke="#eab308" strokeDasharray="3 3" label={{ value: '1.0s Target', fill: '#eab308', fontSize: 10 }} />
                <Line 
                  type="monotone" 
                  dataKey="a6_provider_register" 
                  stroke="#3b82f6" 
                  strokeWidth={2}
                  dot={false}
                  name="A6 /provider_register"
                />
                <Line 
                  type="monotone" 
                  dataKey="a6_health" 
                  stroke="#22c55e" 
                  strokeWidth={2}
                  dot={false}
                  name="A6 /health"
                />
                <Line 
                  type="monotone" 
                  dataKey="a3_to_a6_call" 
                  stroke="#a855f7" 
                  strokeWidth={2}
                  dot={false}
                  name="A3→A6 Call Path"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-400" />
                Error Rate & Throttle State
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={overlayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis yAxisId="left" stroke="#94a3b8" domain={[0, 2]} />
                  <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" domain={[0, 1]} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                  <Legend />
                  <ReferenceLine yAxisId="left" y={0.5} stroke="#ef4444" strokeDasharray="5 5" />
                  <Line 
                    yAxisId="left"
                    type="monotone" 
                    dataKey="error_rate" 
                    stroke="#ef4444" 
                    strokeWidth={2}
                    dot={false}
                    name="Error Rate %"
                  />
                  <Bar 
                    yAxisId="right"
                    dataKey="throttle_state" 
                    fill="#eab308"
                    opacity={0.3}
                    name="Throttle State"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                Cache Hit % & Autoscaling Reserves
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={overlayData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#94a3b8" domain={[0, 100]} />
                  <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                  <Legend />
                  <ReferenceLine y={10} stroke="#eab308" strokeDasharray="5 5" label={{ value: '10% min', fill: '#eab308', fontSize: 10 }} />
                  <Area 
                    type="monotone" 
                    dataKey="cache_hit_pct" 
                    stroke="#22c55e" 
                    fill="#22c55e"
                    fillOpacity={0.3}
                    name="Cache Hit %"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="autoscaling_reserves" 
                    stroke="#3b82f6" 
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    name="Autoscale Reserves %"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
        
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-purple-400" />
              Backlog Depth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={overlayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
                <ReferenceLine y={10} stroke="#ef4444" strokeDasharray="5 5" label={{ value: 'Gate: 10', fill: '#ef4444', fontSize: 10 }} />
                <Area 
                  type="monotone" 
                  dataKey="backlog_depth" 
                  stroke="#a855f7" 
                  fill="#a855f7"
                  fillOpacity={0.5}
                  name="Backlog Depth"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        
        {data.annotations.length > 0 && (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle>Annotations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.annotations.map((ann, i) => (
                  <div key={i} className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">{formatTime(ann.timestamp)}</span>
                    <Badge variant={ann.type.includes('open') ? 'destructive' : 'default'}>
                      {ann.type}
                    </Badge>
                    <span>{ann.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle>Decision Logic</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div className="p-3 rounded bg-green-950 border border-green-800">
                <div className="font-bold text-green-400">GREEN</div>
                <div className="text-slate-400">P95 ≤1.0s falling, error &lt;0.3%</div>
                <div className="text-xs text-slate-500 mt-1">Continue probes; cancel maintenance if 30-min green</div>
              </div>
              <div className="p-3 rounded bg-yellow-950 border border-yellow-800">
                <div className="font-bold text-yellow-400">YELLOW</div>
                <div className="text-slate-400">P95 1.0-1.25s or flat, error &lt;0.5%</div>
                <div className="text-xs text-slate-500 mt-1">Hold posture; warm cache; autoscale ≥10%</div>
              </div>
              <div className="p-3 rounded bg-red-950 border border-red-800">
                <div className="font-bold text-red-400">RED</div>
                <div className="text-slate-400">P95 &gt;1.25s or error ≥0.5%</div>
                <div className="text-xs text-slate-500 mt-1">THROTTLE; page immediately; prepare rollback</div>
              </div>
              <div className="p-3 rounded bg-red-950 border border-red-700 animate-pulse">
                <div className="font-bold text-red-300">CRITICAL</div>
                <div className="text-slate-400">P95 ≥1.5s or error ≥1.0%</div>
                <div className="text-xs text-slate-500 mt-1">KILL and roll back; Student-Only mode</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
