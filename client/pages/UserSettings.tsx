import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authFetch } from '@/utils/authFetch';
import {
  IconArrowLeft,
  IconMail,
  IconCheck,
  IconAlertCircle,
  IconLoader2,
} from '@tabler/icons-react';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';

interface PendingEmailChange {
  newEmail: string;
  expiresAt: string;
}

export default function UserSettings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, accessToken, checkAuth } = useAuthStore();

  // Profile state
  const [name, setName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Email change state
  const [newEmail, setNewEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingChange, setPendingChange] = useState<PendingEmailChange | null>(null);
  const [emailStep, setEmailStep] = useState<'idle' | 'pending'>('idle');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);


  // Handle URL params for magic link results
  useEffect(() => {
    const emailChanged = searchParams.get('emailChanged');
    const emailError = searchParams.get('emailError');

    if (emailChanged === 'true') {
      toast.success('Email updated successfully!');
      checkAuth(); // Refresh user data
      setSearchParams({});
    } else if (emailError) {
      if (emailError === 'invalid_or_expired') {
        toast.error('The verification link is invalid or has expired.');
      } else {
        toast.error('Failed to verify email change.');
      }
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, checkAuth]);

  // Load user settings
  useEffect(() => {
    if (user) {
      setName(user.name || '');
    }

    // Fetch pending email change
    const fetchSettings = async () => {
      try {
        const response = await authFetch('/api/user');
        if (response.ok) {
          const data = await response.json();
          if (data.pendingEmailChange) {
            setPendingChange(data.pendingEmailChange);
            setEmailStep('pending');
          }
        }
      } catch (err) {
        console.error('Failed to fetch user settings:', err);
      }
    };

    if (accessToken) {
      fetchSettings();
    }
  }, [user, accessToken]);

  // Save profile
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);

    try {
      const response = await authFetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || null }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      toast.success('Profile updated!');
      checkAuth(); // Refresh user data
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  };

  // Request email change
  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    if (!newEmail.trim() || !newEmail.includes('@')) {
      setEmailError('Please enter a valid email address');
      return;
    }

    if (newEmail.trim().toLowerCase() === user?.email?.toLowerCase()) {
      setEmailError('New email is the same as current email');
      return;
    }

    setSendingCode(true);

    try {
      const response = await authFetch('/api/user/email/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newEmail: newEmail.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification code');
      }

      setPendingChange({ newEmail: newEmail.trim(), expiresAt: data.expiresAt });
      setEmailStep('pending');
      toast.success('Verification code sent to ' + newEmail.trim());
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send verification code');
    } finally {
      setSendingCode(false);
    }
  };

  // Verify code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);

    if (verificationCode.length !== 6) {
      setEmailError('Please enter the 6-digit code');
      return;
    }

    setVerifyingCode(true);

    try {
      const response = await authFetch('/api/user/email/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verificationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify code');
      }

      toast.success('Email updated successfully!');
      setPendingChange(null);
      setEmailStep('idle');
      setNewEmail('');
      setVerificationCode('');
      checkAuth(); // Refresh user data
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setVerifyingCode(false);
    }
  };

  // Cancel email change
  const handleCancelEmailChange = () => {
    setPendingChange(null);
    setEmailStep('idle');
    setNewEmail('');
    setVerificationCode('');
    setEmailError(null);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <IconArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Account Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your account preferences
            </p>
          </div>
        </div>

        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update your display name</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <Button type="submit" disabled={savingProfile}>
                {savingProfile && <IconLoader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Email Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconMail className="w-5 h-5" />
              Email Address
            </CardTitle>
            <CardDescription>
              Change your email address with verification
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current email */}
            <div className="p-3 bg-muted rounded-lg">
              <Label className="text-xs text-muted-foreground">Current Email</Label>
              <p className="font-medium">{user?.email}</p>
              {user?.emailVerifiedAt && (
                <div className="flex items-center gap-1 mt-1 text-xs text-green-600 dark:text-green-400">
                  <IconCheck className="w-3 h-3" />
                  Verified
                </div>
              )}
            </div>

            {/* Email change form */}
            {emailStep === 'idle' ? (
              <form onSubmit={handleRequestEmailChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newEmail">New Email Address</Label>
                  <Input
                    id="newEmail"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new@example.com"
                  />
                </div>

                {emailError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                    <IconAlertCircle className="w-4 h-4 flex-shrink-0" />
                    {emailError}
                  </div>
                )}

                <Button type="submit" disabled={sendingCode || !newEmail.trim()}>
                  {sendingCode && <IconLoader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Send Verification Code
                </Button>
              </form>
            ) : (
              <div className="space-y-4">
                {/* Pending change info */}
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    We sent a verification code to{' '}
                    <strong>{pendingChange?.newEmail}</strong>
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    Enter the 6-digit code below, or click the magic link in the email.
                  </p>
                </div>

                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="code">Verification Code</Label>
                    <Input
                      id="code"
                      value={verificationCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setVerificationCode(val);
                      }}
                      placeholder="000000"
                      maxLength={6}
                      className="text-center text-2xl tracking-widest font-mono"
                    />
                  </div>

                  {emailError && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                      <IconAlertCircle className="w-4 h-4 flex-shrink-0" />
                      {emailError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={verifyingCode || verificationCode.length !== 6}
                    >
                      {verifyingCode && (
                        <IconLoader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      Verify Code
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancelEmailChange}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>

                {/* Resend option */}
                <div className="pt-2 border-t">
                  <button
                    type="button"
                    onClick={handleRequestEmailChange}
                    disabled={sendingCode}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  >
                    {sendingCode ? 'Sending...' : "Didn't receive the code? Send again"}
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
