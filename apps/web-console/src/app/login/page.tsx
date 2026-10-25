import Link from 'next/link';
import { LogoMark } from '../../components/icons';
import '../../styles.css';

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-glow" />
      <section className="auth-card">
        <LogoMark />
        <p className="eyebrow">PLANEMEM / WORK CONTINUITY PLATFORM</p>
        <h1>Sign in to Workbench</h1>
        <p className="muted">
          Use the existing Hedou identity service to access scoped project data.
        </p>
        <Link className="primary-button auth-button" href="/auth/login">
          Continue with Hedou AuthServer
        </Link>
        <p className="auth-footnote">
          OpenIddict authorization code + PKCE · project scope enforced
        </p>
      </section>
    </main>
  );
}
