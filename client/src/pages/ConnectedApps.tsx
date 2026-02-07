import { useState, useEffect } from 'react';
import { ExternalLink, Users, UserCheck, Calendar, TrendingUp, RefreshCw, ArrowLeft, Activity, Clock, GraduationCap } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import { Footer } from '@/components/layout/Footer';

interface AppMetrics {
  dau: number;
  wau: number;
  newUsers24h: number;
  lastLogin: string | null;
}

interface RecentEvent {
  id: string;
  appId: string;
  userId: string;
  event: string;
  timestamp: string;
  correlationId: string;
  metadata: any;
}

export default function ConnectedApps() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const [metrics, setMetrics] = useState<{ student: AppMetrics; provider: AppMetrics } | null>(null);
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      loadDashboardData();
    }
  }, [isAuthenticated]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const [metricsResponse, eventsResponse] = await Promise.all([
        apiRequest('GET', '/api/metrics/apps'),
        apiRequest('GET', '/api/events/recent?limit=10')
      ]);
      
      const metricsData = await metricsResponse.json();
      const eventsData = await eventsResponse.json();
      
      setMetrics(metricsData);
      setRecentEvents(eventsData.events || []);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const formatLastLogin = (lastLogin: string | null) => {
    if (!lastLogin) return 'Never';
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(lastLogin));
  };

  const getEventIcon = (event: string) => {
    switch (event) {
      case 'auth.login': return '🔐';
      case 'auth.logout': return '🚪';
      case 'email.verified': return '✅';
      default: return '📝';
    }
  };

  if (isLoading || loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid white', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }}></div>
          <p style={{ color: 'white', fontSize: '18px' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ 
          background: 'white', 
          borderRadius: '16px', 
          padding: '48px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: '400px'
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', marginBottom: '12px' }}>
            Authentication Required
          </h1>
          <p style={{ fontSize: '16px', color: '#64748b', marginBottom: '24px' }}>
            Please log in to access the connected apps dashboard.
          </p>
          <a 
            href="/api/login"
            style={{ 
              display: 'inline-block',
              padding: '14px 32px', 
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 
              color: 'white', 
              borderRadius: '10px', 
              fontSize: '16px', 
              fontWeight: '600', 
              textDecoration: 'none'
            }}
          >
            Log In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%)' }}>
      {/* Professional Navigation Header */}
      <nav style={{ 
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 50
      }}>
        <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '72px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Link href="/">
                <button style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '8px 16px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: 'white', 
                  fontSize: '14px',
                  cursor: 'pointer'
                }}>
                  <ArrowLeft style={{ width: '16px', height: '16px' }} />
                  Back
                </button>
              </Link>
              <div style={{ 
                width: '48px', 
                height: '48px', 
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)'
              }}>
                <Activity style={{ color: 'white', width: '28px', height: '28px' }} />
              </div>
              <div>
                <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'white', margin: 0, letterSpacing: '-0.5px' }}>Connected Applications</h1>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', margin: 0 }}>Ecosystem Management</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                fontSize: '16px',
                fontWeight: '600',
                color: 'white'
              }}>
                {user?.firstName?.charAt(0) || user?.email?.charAt(0) || 'U'}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '14px', fontWeight: '600', color: 'white', margin: 0 }}>
                  {user?.firstName && user?.lastName 
                    ? `${user.firstName} ${user.lastName}`
                    : user?.email
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: '40px' }}>
          <h1 style={{ fontSize: '36px', fontWeight: '700', color: '#1e293b', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
            Ecosystem Dashboard
          </h1>
          <p style={{ fontSize: '18px', color: '#64748b', margin: 0 }}>
            Monitor and manage your integrated scholarship platform applications
          </p>
        </div>

        {error && (
          <div style={{ 
            marginBottom: '24px', 
            padding: '16px 20px', 
            background: '#fef2f2', 
            border: '1px solid #fecaca', 
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <p style={{ color: '#991b1b', margin: 0, fontSize: '15px' }}>{error}</p>
          </div>
        )}

        {/* Connected Apps Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px', marginBottom: '32px' }}>
          
          {/* Student Portal Card */}
          <div style={{ 
            background: 'white', 
            borderRadius: '20px', 
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0'
          }}>
            {/* Card Header with gradient */}
            <div style={{ 
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 
              padding: '24px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ 
                position: 'absolute', 
                top: '-30px', 
                right: '-30px', 
                width: '120px', 
                height: '120px', 
                background: 'rgba(255,255,255,0.1)', 
                borderRadius: '50%' 
              }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ 
                    width: '52px', 
                    height: '52px', 
                    background: 'rgba(255,255,255,0.2)', 
                    borderRadius: '12px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    <GraduationCap style={{ color: 'white', width: '28px', height: '28px' }} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'white', margin: 0 }}>Student Portal</h2>
                    <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', margin: '4px 0 0 0' }}>B2C scholarship application platform</p>
                  </div>
                </div>
                <span style={{ 
                  padding: '6px 14px', 
                  background: 'rgba(255,255,255,0.2)', 
                  color: 'white', 
                  borderRadius: '20px', 
                  fontSize: '13px', 
                  fontWeight: '600',
                  backdropFilter: 'blur(10px)'
                }}>Active</span>
              </div>
            </div>
            
            {/* Card Content */}
            <div style={{ padding: '24px' }}>
              {/* Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ 
                  background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', 
                  borderRadius: '12px', 
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Users style={{ width: '20px', height: '20px', color: '#3b82f6' }} />
                    <span style={{ fontSize: '32px', fontWeight: '700', color: '#1e40af' }}>
                      {metrics?.student?.dau || 0}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#3b82f6', margin: 0, fontWeight: '500' }}>Daily Active Users</p>
                </div>
                <div style={{ 
                  background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', 
                  borderRadius: '12px', 
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                    <UserCheck style={{ width: '20px', height: '20px', color: '#10b981' }} />
                    <span style={{ fontSize: '32px', fontWeight: '700', color: '#065f46' }}>
                      {metrics?.student?.newUsers24h || 0}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#10b981', margin: 0, fontWeight: '500' }}>New Users (24h)</p>
                </div>
              </div>

              {/* Stats Row */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '16px', 
                background: '#f8fafc', 
                borderRadius: '10px',
                marginBottom: '20px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock style={{ width: '16px', height: '16px', color: '#64748b' }} />
                  <span style={{ fontSize: '14px', color: '#64748b' }}>Last Login:</span>
                  <span style={{ fontSize: '14px', color: '#1e293b', fontWeight: '500' }}>
                    {formatLastLogin(metrics?.student?.lastLogin || null)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp style={{ width: '16px', height: '16px', color: '#64748b' }} />
                  <span style={{ fontSize: '14px', color: '#64748b' }}>WAU:</span>
                  <span style={{ fontSize: '14px', color: '#1e293b', fontWeight: '600' }}>
                    {metrics?.student?.wau || 0}
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <a 
                href="https://student-pilot-jamarrlmayes.replit.app" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '10px', 
                  padding: '16px 24px', 
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 
                  color: 'white', 
                  borderRadius: '12px', 
                  fontSize: '16px', 
                  fontWeight: '600', 
                  textDecoration: 'none',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                  width: '100%'
                }}
              >
                Open Student Portal
                <ExternalLink style={{ width: '18px', height: '18px' }} />
              </a>
            </div>
          </div>

          {/* Provider Portal Card */}
          <div style={{ 
            background: 'white', 
            borderRadius: '20px', 
            overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0'
          }}>
            {/* Card Header with gradient */}
            <div style={{ 
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
              padding: '24px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{ 
                position: 'absolute', 
                top: '-30px', 
                right: '-30px', 
                width: '120px', 
                height: '120px', 
                background: 'rgba(255,255,255,0.1)', 
                borderRadius: '50%' 
              }}></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ 
                    width: '52px', 
                    height: '52px', 
                    background: 'rgba(255,255,255,0.2)', 
                    borderRadius: '12px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                  }}>
                    <Users style={{ color: 'white', width: '28px', height: '28px' }} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'white', margin: 0 }}>Provider Portal</h2>
                    <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', margin: '4px 0 0 0' }}>B2B scholarship management platform</p>
                  </div>
                </div>
                <span style={{ 
                  padding: '6px 14px', 
                  background: 'rgba(255,255,255,0.2)', 
                  color: 'white', 
                  borderRadius: '20px', 
                  fontSize: '13px', 
                  fontWeight: '600',
                  backdropFilter: 'blur(10px)'
                }}>Active</span>
              </div>
            </div>
            
            {/* Card Content */}
            <div style={{ padding: '24px' }}>
              {/* Metrics Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '20px' }}>
                <div style={{ 
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', 
                  borderRadius: '12px', 
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                    <Users style={{ width: '20px', height: '20px', color: '#10b981' }} />
                    <span style={{ fontSize: '32px', fontWeight: '700', color: '#065f46' }}>
                      {metrics?.provider?.dau || 0}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#10b981', margin: 0, fontWeight: '500' }}>Daily Active Users</p>
                </div>
                <div style={{ 
                  background: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)', 
                  borderRadius: '12px', 
                  padding: '20px',
                  textAlign: 'center'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                    <UserCheck style={{ width: '20px', height: '20px', color: '#14b8a6' }} />
                    <span style={{ fontSize: '32px', fontWeight: '700', color: '#115e59' }}>
                      {metrics?.provider?.newUsers24h || 0}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#14b8a6', margin: 0, fontWeight: '500' }}>New Users (24h)</p>
                </div>
              </div>

              {/* Stats Row */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                padding: '16px', 
                background: '#f8fafc', 
                borderRadius: '10px',
                marginBottom: '20px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock style={{ width: '16px', height: '16px', color: '#64748b' }} />
                  <span style={{ fontSize: '14px', color: '#64748b' }}>Last Login:</span>
                  <span style={{ fontSize: '14px', color: '#1e293b', fontWeight: '500' }}>
                    {formatLastLogin(metrics?.provider?.lastLogin || null)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp style={{ width: '16px', height: '16px', color: '#64748b' }} />
                  <span style={{ fontSize: '14px', color: '#64748b' }}>WAU:</span>
                  <span style={{ fontSize: '14px', color: '#1e293b', fontWeight: '600' }}>
                    {metrics?.provider?.wau || 0}
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <a 
                href="https://provider-register-jamarrlmayes.replit.app" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '10px', 
                  padding: '16px 24px', 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  color: 'white', 
                  borderRadius: '12px', 
                  fontSize: '16px', 
                  fontWeight: '600', 
                  textDecoration: 'none',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                  width: '100%'
                }}
              >
                Open Provider Portal
                <ExternalLink style={{ width: '18px', height: '18px' }} />
              </a>
            </div>
          </div>
        </div>

        {/* Recent Activity Section */}
        <div style={{ 
          background: 'white', 
          borderRadius: '20px', 
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0'
        }}>
          {/* Section Header */}
          <div style={{ 
            padding: '24px 28px', 
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Activity style={{ color: 'white', width: '22px', height: '22px' }} />
              </div>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#1e293b', margin: 0 }}>Recent Activity</h2>
                <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>Latest events from connected applications</p>
              </div>
            </div>
            <button 
              onClick={loadDashboardData}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '10px 20px', 
                background: '#f1f5f9', 
                border: '1px solid #e2e8f0', 
                borderRadius: '10px', 
                fontSize: '14px', 
                fontWeight: '500', 
                color: '#334155', 
                cursor: 'pointer'
              }}
            >
              <RefreshCw style={{ width: '16px', height: '16px' }} />
              Refresh
            </button>
          </div>
          
          {/* Activity Content */}
          <div style={{ padding: '24px 28px' }}>
            {recentEvents.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '48px 24px',
                background: '#f8fafc',
                borderRadius: '12px'
              }}>
                <div style={{ 
                  width: '64px', 
                  height: '64px', 
                  background: 'linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)', 
                  borderRadius: '50%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <Activity style={{ color: '#64748b', width: '28px', height: '28px' }} />
                </div>
                <p style={{ color: '#64748b', fontSize: '16px', margin: '0 0 8px 0', fontWeight: '500' }}>No recent activity to display</p>
                <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>Events from connected apps will appear here</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {recentEvents.map((event) => (
                  <div 
                    key={event.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between', 
                      padding: '16px 20px', 
                      background: '#f8fafc', 
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <span style={{ fontSize: '24px' }} aria-hidden="true">
                        {getEventIcon(event.event)}
                      </span>
                      <div>
                        <p style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', margin: 0 }}>
                          {event.event.replace('auth.', '').replace('email.', '').replace('.', ' ').toUpperCase()}
                        </p>
                        <p style={{ fontSize: '13px', color: '#64748b', margin: '4px 0 0 0' }}>
                          {event.appId === 'student' ? 'Student Portal' : 'Provider Portal'}
                          {event.correlationId && (
                            <span style={{ marginLeft: '8px', opacity: 0.7 }}>
                              ID: {event.correlationId.slice(0, 8)}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                        {new Intl.DateTimeFormat('en-US', {
                          dateStyle: 'short',
                          timeStyle: 'short'
                        }).format(new Date(event.timestamp))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <Footer variant="minimal" />
    </div>
  );
}
