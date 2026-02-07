import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Footer } from "@/components/layout/Footer";
import { GraduationCap, Shield, User as UserIcon, Settings, LogOut, CheckCircle, AlertCircle, ExternalLink, Users, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

const A5_BASE_URL = 'https://student-pilot-jamarrlmayes.replit.app';

export default function Home() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      console.log('🔐 Auth check: Not authenticated, redirecting to login');
      toast({
        title: "Unauthorized",
        description: "Please log in to continue...",
        variant: "destructive",
      });
      window.location.href = "/api/login";
    }
  }, [isLoading, isAuthenticated, toast]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user && user.role !== 'admin') {
      console.log('🛡️ A1 Internal Gate: Non-admin user detected, redirecting to A5');
      toast({
        title: "Redirecting",
        description: "Taking you to the student portal...",
      });
      setTimeout(() => {
        window.location.href = A5_BASE_URL;
      }, 1000);
    }
  }, [user, isLoading, isAuthenticated, toast]);

  const handleLogout = () => {
    window.location.href = "/api/logout";
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid white', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }}></div>
          <p style={{ color: 'white', fontSize: '18px' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return null;
  }

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'admin':
        return { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };
      case 'reviewer':
        return { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' };
      default:
        return { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' };
    }
  };

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
              <div style={{ 
                width: '48px', 
                height: '48px', 
                background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)', 
                borderRadius: '12px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)'
              }}>
                <GraduationCap style={{ color: 'white', width: '28px', height: '28px' }} />
              </div>
              <div>
                <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'white', margin: 0, letterSpacing: '-0.5px' }}>ScholarshipAI</h1>
                <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', margin: 0 }}>Admin Dashboard</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
                fontSize: '18px',
                fontWeight: '600',
                color: 'white'
              }}>
                {user.firstName?.charAt(0) || user.email?.charAt(0) || 'U'}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '15px', fontWeight: '600', color: 'white', margin: 0 }}>
                  {user.firstName && user.lastName 
                    ? `${user.firstName} ${user.lastName}`
                    : user.email
                  }
                </p>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>{user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '10px 18px', 
                  background: 'rgba(255,255,255,0.1)', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  borderRadius: '8px', 
                  color: 'white', 
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              >
                <LogOut style={{ width: '16px', height: '16px' }} />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Welcome Section */}
        <div style={{ marginBottom: '40px' }}>
          <h1 style={{ fontSize: '36px', fontWeight: '700', color: '#1e293b', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
            Welcome back, {user?.firstName || 'User'}!
          </h1>
          <p style={{ fontSize: '18px', color: '#64748b', margin: 0 }}>
            Manage your ScholarshipAI account and explore opportunities.
          </p>
        </div>

        {/* Stats Cards Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '32px' }}>
          
          {/* Profile Card */}
          <div style={{ 
            background: 'white', 
            borderRadius: '16px', 
            padding: '28px', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', 
                borderRadius: '10px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <UserIcon style={{ color: 'white', width: '20px', height: '20px' }} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b', margin: 0 }}>Profile Information</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: '#64748b' }}>Role</span>
                <span style={{ 
                  padding: '6px 14px', 
                  borderRadius: '20px', 
                  fontSize: '13px', 
                  fontWeight: '600',
                  ...getRoleBadgeStyle(user?.role || 'student')
                }}>
                  {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: '#64748b' }}>Email Status</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {user?.isEmailVerified ? (
                    <CheckCircle style={{ width: '18px', height: '18px', color: '#10b981' }} />
                  ) : (
                    <AlertCircle style={{ width: '18px', height: '18px', color: '#f59e0b' }} />
                  )}
                  <span style={{ fontSize: '14px', fontWeight: '500', color: user?.isEmailVerified ? '#10b981' : '#f59e0b' }}>
                    {user?.isEmailVerified ? 'Verified' : 'Unverified'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', color: '#64748b' }}>Member Since</span>
                <span style={{ fontSize: '14px', fontWeight: '500', color: '#1e293b' }}>
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div style={{ 
            background: 'white', 
            borderRadius: '16px', 
            padding: '28px', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', 
                borderRadius: '10px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Settings style={{ color: 'white', width: '20px', height: '20px' }} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b', margin: 0 }}>Quick Actions</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px', 
                padding: '14px 18px', 
                background: '#f8fafc', 
                border: '1px solid #e2e8f0', 
                borderRadius: '10px', 
                fontSize: '14px',
                fontWeight: '500',
                color: '#334155',
                cursor: 'pointer',
                transition: 'all 0.2s',
                width: '100%',
                textAlign: 'left'
              }}>
                <UserIcon style={{ width: '18px', height: '18px', color: '#6366f1' }} />
                Update Profile
              </button>
              <button style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px', 
                padding: '14px 18px', 
                background: '#f8fafc', 
                border: '1px solid #e2e8f0', 
                borderRadius: '10px', 
                fontSize: '14px',
                fontWeight: '500',
                color: '#334155',
                cursor: 'pointer',
                transition: 'all 0.2s',
                width: '100%',
                textAlign: 'left'
              }}>
                <Shield style={{ width: '18px', height: '18px', color: '#10b981' }} />
                Change Password
              </button>
            </div>
          </div>

          {/* Security Status Card */}
          <div style={{ 
            background: 'white', 
            borderRadius: '16px', 
            padding: '28px', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                borderRadius: '10px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Shield style={{ color: 'white', width: '20px', height: '20px' }} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#1e293b', margin: 0 }}>Security Status</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle style={{ width: '20px', height: '20px', color: '#10b981' }} />
                <span style={{ fontSize: '14px', color: '#334155' }}>Two-factor authentication ready</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle style={{ width: '20px', height: '20px', color: '#10b981' }} />
                <span style={{ fontSize: '14px', color: '#334155' }}>Secure password policy</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <CheckCircle style={{ width: '20px', height: '20px', color: '#10b981' }} />
                <span style={{ fontSize: '14px', color: '#334155' }}>Rate limiting active</span>
              </div>
            </div>
          </div>
        </div>

        {/* Connected Apps Section */}
        <div style={{ 
          background: 'white', 
          borderRadius: '16px', 
          padding: '32px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          border: '1px solid #e2e8f0',
          marginBottom: '32px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
              borderRadius: '10px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <ExternalLink style={{ color: 'white', width: '20px', height: '20px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#1e293b', margin: 0 }}>Connected Apps</h2>
              <p style={{ fontSize: '14px', color: '#64748b', margin: '4px 0 0 0' }}>Manage and monitor your integrated scholarship ecosystem</p>
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
            {/* Student Portal */}
            <div style={{ 
              background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', 
              borderRadius: '12px', 
              padding: '24px',
              border: '1px solid #bfdbfe'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#1e40af', margin: '0 0 4px 0' }}>Student Portal</h3>
                  <p style={{ fontSize: '13px', color: '#3b82f6', margin: 0 }}>B2C application platform</p>
                </div>
                <span style={{ 
                  padding: '4px 12px', 
                  background: '#10b981', 
                  color: 'white', 
                  borderRadius: '20px', 
                  fontSize: '12px', 
                  fontWeight: '600' 
                }}>Active</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users style={{ width: '18px', height: '18px', color: '#3b82f6' }} />
                  <span style={{ fontSize: '14px', color: '#1e40af' }}>0 DAU</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp style={{ width: '18px', height: '18px', color: '#3b82f6' }} />
                  <span style={{ fontSize: '14px', color: '#1e40af' }}>0 WAU</span>
                </div>
              </div>
              <a 
                href="https://student-pilot-jamarrlmayes.replit.app" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '10px 20px', 
                  background: '#3b82f6', 
                  color: 'white', 
                  borderRadius: '8px', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  textDecoration: 'none',
                  transition: 'background 0.2s'
                }}
              >
                <ExternalLink style={{ width: '16px', height: '16px' }} />
                Open Portal
              </a>
            </div>

            {/* Provider Portal */}
            <div style={{ 
              background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)', 
              borderRadius: '12px', 
              padding: '24px',
              border: '1px solid #a7f3d0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#065f46', margin: '0 0 4px 0' }}>Provider Portal</h3>
                  <p style={{ fontSize: '13px', color: '#10b981', margin: 0 }}>B2B management platform</p>
                </div>
                <span style={{ 
                  padding: '4px 12px', 
                  background: '#10b981', 
                  color: 'white', 
                  borderRadius: '20px', 
                  fontSize: '12px', 
                  fontWeight: '600' 
                }}>Active</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users style={{ width: '18px', height: '18px', color: '#10b981' }} />
                  <span style={{ fontSize: '14px', color: '#065f46' }}>0 DAU</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <TrendingUp style={{ width: '18px', height: '18px', color: '#10b981' }} />
                  <span style={{ fontSize: '14px', color: '#065f46' }}>0 WAU</span>
                </div>
              </div>
              <a 
                href="https://provider-register-jamarrlmayes.replit.app" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  padding: '10px 20px', 
                  background: '#10b981', 
                  color: 'white', 
                  borderRadius: '8px', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  textDecoration: 'none',
                  transition: 'background 0.2s'
                }}
              >
                <ExternalLink style={{ width: '16px', height: '16px' }} />
                Open Portal
              </a>
            </div>
          </div>

          <div style={{ marginTop: '24px', textAlign: 'center' }}>
            <Link href="/connected-apps">
              <button style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '12px 28px', 
                background: '#f1f5f9', 
                border: '1px solid #e2e8f0', 
                borderRadius: '10px', 
                fontSize: '14px', 
                fontWeight: '500', 
                color: '#334155', 
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                <ExternalLink style={{ width: '16px', height: '16px' }} />
                View Full Dashboard
              </button>
            </Link>
          </div>
        </div>

        {/* Admin Dashboard Section */}
        {user?.role === 'admin' && (
          <div style={{ 
            background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)', 
            borderRadius: '16px', 
            padding: '32px', 
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            marginBottom: '32px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ 
                width: '44px', 
                height: '44px', 
                background: 'rgba(255,255,255,0.15)', 
                borderRadius: '10px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center' 
              }}>
                <Shield style={{ color: 'white', width: '24px', height: '24px' }} />
              </div>
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: '600', color: 'white', margin: 0 }}>Admin Dashboard</h2>
                <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', margin: '4px 0 0 0' }}>You have administrative access to manage users and system settings.</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <button style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '14px 28px', 
                background: 'white', 
                border: 'none', 
                borderRadius: '10px', 
                fontSize: '15px', 
                fontWeight: '600', 
                color: '#1e3a5f', 
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
              }}>
                <Users style={{ width: '18px', height: '18px' }} />
                Manage Users
              </button>
              <button style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '8px', 
                padding: '14px 28px', 
                background: 'rgba(255,255,255,0.1)', 
                border: '1px solid rgba(255,255,255,0.3)', 
                borderRadius: '10px', 
                fontSize: '15px', 
                fontWeight: '500', 
                color: 'white', 
                cursor: 'pointer'
              }}>
                <Settings style={{ width: '18px', height: '18px' }} />
                System Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <Footer variant="minimal" />
    </div>
  );
}
