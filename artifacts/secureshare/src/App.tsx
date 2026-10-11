import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BadgeCheck, Camera, Check, CheckCircle2,
  ChevronDown, ChevronRight, Clock3, Copy, File as FileIcon, FileImage, FileText, FileUp,
  Fingerprint, FolderClosed, HardDrive, KeyRound, Link2, LoaderCircle, LockKeyhole, LogOut,
  Menu, Plus, RefreshCw, Shield, ShieldCheck, Trash2, Upload, Users, Video,
  X, XCircle, Eye, ExternalLink
} from 'lucide-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import {
  useHealthCheck, useGetAdminBootstrapState, useClaimInitialAdmin, useGetDashboardSummary,
  useListFiles, useCreateFile, useDeleteFile, useRequestUploadUrl, useListLinks,
  useCreateLink, useUpdateLink, useDeleteLink, useListActivity, useGetPublicShare,
  useGetSharedFileContent, useDownloadSharedFile, useRequestSubmissionUploadUrl,
  useCreateSubmission, useListSubmissions, useGetSubmissionContent, useDeleteSubmission,
  getGetAdminBootstrapStateQueryKey, getGetDashboardSummaryQueryKey, getListFilesQueryKey,
  getListLinksQueryKey, getListSubmissionsQueryKey,
  getGetPublicShareQueryKey, getGetSharedFileContentQueryKey, getDownloadSharedFileQueryKey,
  getGetSubmissionContentQueryKey
} from '@workspace/api-client-react';
import type { ActivityRecord, FileRecord, ShareLink, SubmissionRecord } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#244f49',
    colorForeground: '#203c39',
    colorMutedForeground: '#6e7f79',
    colorDanger: '#a64d43',
    colorBackground: '#fbfaf6',
    colorInput: '#fffefa',
    colorInputForeground: '#203c39',
    colorNeutral: '#d9ddd4',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf6] rounded-[24px] w-[440px] max-w-full overflow-hidden border border-[#d9ddd4]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-semibold tracking-[-0.04em] text-[#203c39]',
    headerSubtitle: 'text-[#6e7f79]',
    socialButtonsBlockButtonText: 'text-[#203c39] font-medium',
    formFieldLabel: 'text-[#38534e] font-medium',
    footerActionLink: 'text-[#24574e] font-semibold',
    footerActionText: 'text-[#71817b]',
    dividerText: 'text-[#87948e]',
    formButtonPrimary: 'bg-[#244f49] hover:bg-[#183f39] rounded-xl shadow-none',
    formFieldInput: 'rounded-xl border-[#d9ddd4] bg-[#fffefa]',
  },
};

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <span className={`brand-lockup ${inverse ? 'brand-lockup-inverse' : ''}`}><span className="brand-mark"><LockKeyhole size={18} strokeWidth={2.2} /></span><span>secure<span className="brand-share">share</span></span></span>;
}

function Button({ children, onClick, kind = 'primary', disabled, type = 'button', className = '', testId }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'quiet' | 'danger' | 'outline'; disabled?: boolean; type?: 'button' | 'submit'; className?: string; testId?: string;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`button button-${kind} ${className}`}>{children}</button>;
}

function LoadingPanel({ label = 'Loading your secure workspace' }: { label?: string }) {
  return <div className="loading-panel" role="status"><span className="skeleton-line skeleton-short" /><span className="skeleton-line" /><span className="skeleton-line skeleton-mid" /><span className="loading-caption"><LoaderCircle size={15} className="spin" />{label}</span></div>;
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return <div className="state-panel state-error"><span className="state-icon"><XCircle size={20} /></span><div><strong>We couldn't load this view</strong><p>{message}</p><Button kind="outline" onClick={retry}><RefreshCw size={15} /> Try again</Button></div></div>;
}

function EmptyPanel({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-panel"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="title-action">{action}</div>}</div>;
}

function AdminFrame({ children, active }: { children: ReactNode; active: string }) {
  const [location] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = [
    { href: '/dashboard', label: 'Overview', icon: <Activity size={17} /> },
    { href: '/files', label: 'Private files', icon: <FolderClosed size={17} /> },
    { href: '/links', label: 'Sharing links', icon: <Link2 size={17} /> },
    { href: '/activity', label: 'Access activity', icon: <Clock3 size={17} /> },
    { href: '/submissions', label: 'Submissions', icon: <Users size={17} /> },
  ];
  return <div className="admin-layout">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Logo inverse /><span className="brand-caption">PRIVATE HANDOFFS</span></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="side-nav">{links.map((item) => <Link key={item.href} href={item.href} className={`side-link ${active === item.href ? 'side-link-active' : ''}`} onClick={() => setMobileOpen(false)} data-testid={`nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}>{item.icon}<span>{item.label}</span>{active === item.href && <span className="nav-active-mark" />}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-secure"><span><ShieldCheck size={17} /></span><div><strong>Private by default</strong><small>Your files stay yours.</small></div></div><div className="account-row"><span className="account-avatar">{(user?.firstName || user?.emailAddresses?.[0]?.emailAddress || 'A').slice(0, 1).toUpperCase()}</span><span className="account-name"><strong>{user?.fullName || 'Administrator'}</strong><small>{user?.emailAddresses?.[0]?.emailAddress || 'SecureShare account'}</small></span><button className="icon-button sidebar-logout" onClick={() => signOut({ redirectUrl: basePath || '/' })} aria-label="Sign out" data-testid="button-sign-out"><LogOut size={16} /></button></div></div>
    </aside>
    {mobileOpen && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <main className="main-shell"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle navigation" data-testid="button-mobile-menu"><Menu size={20} /></button><div className="breadcrumb"><span>SecureShare</span><ChevronRight size={14} /><strong>{links.find((item) => item.href === active)?.label || 'Workspace'}</strong></div><div className="topbar-right"><span className="topbar-status"><i /> All systems operational</span><span className="topbar-seal"><Shield size={15} /> Admin space</span></div></header><div className="main-content">{children}</div><footer className="workspace-footer"><span>SecureShare <span className="footer-dot">/</span> A careful handoff, at every distance.</span><span className="footer-security"><LockKeyhole size={13} /> Your workspace is private</span></footer></main>
  </div>;
}

function HomePage() {
  const health = useHealthCheck();
  return <div className="landing">
    <header className="landing-header"><Link href="/" className="landing-brand"><Logo /></Link><div className="landing-nav"><a href="#how-it-works">How it works</a><a href="#principles">Our approach</a><Link className="landing-login" href="/sign-in">Administrator sign in <ArrowRight size={15} /></Link></div></header>
    <main>
      <section className="hero-section"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> A quieter way to share what matters</div><h1>Good documents.<br /><em>Careful delivery.</em></h1><p className="hero-lede">SecureShare gives sensitive files a clear route from your hands to theirs—with links you can trust and control you can keep.</p><div className="hero-actions"><Link href="/sign-in" className="button button-primary">Enter your workspace <ArrowRight size={16} /></Link><a href="#how-it-works" className="text-action">See how it works <ChevronDown size={16} /></a></div><div className="hero-proof"><span className="proof-icon"><ShieldCheck size={16} /></span><div><strong>Made for considered sharing</strong><small>No accounts required for recipients</small></div><span className="proof-divider" /><div className="health-indicator"><i className={health.isError ? 'health-down' : ''} />{health.isError ? 'Service check unavailable' : 'Service ready'}</div></div></div>
        <div className="hero-visual"><div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" /><div className="visual-ring ring-outer" /><div className="visual-ring ring-inner" /><div className="document-stack"><div className="document-back"><span className="doc-corner" /></div><div className="document-front"><div className="doc-topline"><span>PRIVATE DOCUMENT</span><LockKeyhole size={14} /></div><div className="doc-emblem"><FileText size={33} strokeWidth={1.4} /></div><div className="doc-lines"><i /><i /><i /></div><div className="doc-file-name">A careful handoff</div><div className="doc-file-type">PDF · 2.4 MB</div></div><div className="doc-seal"><ShieldCheck size={22} /><span>Only the<br />right hands</span></div><div className="visual-spark spark-a" /><div className="visual-spark spark-b" /><div className="visual-note"><span className="note-line" /><div><strong>Access, by invitation</strong><small>Expires when you say so</small></div><LockKeyhole size={16} /></div></div><div className="hero-visual-caption"><span>01 / PRIVATE FILES</span><span>02 / CONTROLLED ACCESS</span></div></div>
      </section>
      <section className="trust-strip"><div><span className="trust-symbol"><KeyRound size={17} /></span><span><strong>One link. Your terms.</strong><small>Expire or revoke in a moment.</small></span></div><div><span className="trust-symbol"><Eye size={17} /></span><span><strong>Know when it was opened.</strong><small>A simple, useful activity trail.</small></span></div><div><span className="trust-symbol"><Fingerprint size={17} /></span><span><strong>Recipient-first access.</strong><small>Clear steps, never a surprise.</small></span></div></section>
      <section id="how-it-works" className="how-section"><div className="section-heading"><div className="eyebrow">A deliberate three-step handoff</div><h2>Control stays with you.<br /><em>Clarity goes with the file.</em></h2></div><div className="steps-row"><article className="step-card"><span className="step-number">01</span><span className="step-icon"><Upload size={21} /></span><h3>Keep it private</h3><p>Upload documents to your private workspace. Nothing is shared until you choose a recipient and create a link.</p><div className="step-rule" /></article><article className="step-card"><span className="step-number">02</span><span className="step-icon"><Link2 size={21} /></span><h3>Share with intention</h3><p>Choose exactly which files travel together. Set an expiry, allow a return submission, or keep the link read-only.</p><div className="step-rule" /></article><article className="step-card"><span className="step-number">03</span><span className="step-icon"><Clock3 size={21} /></span><h3>Stay in the loop</h3><p>See when a link was opened. Revoke access whenever plans change. A handoff should never be a one-way door.</p><div className="step-rule" /></article></div></section>
      <section id="principles" className="principles-section"><div className="principle-art"><div className="principle-ring"><span className="principle-core"><LockKeyhole size={30} /></span><span className="orbit-label label-top">PRIVATE</span><span className="orbit-label label-right">CONTROLLED</span><span className="orbit-label label-bottom">VISIBLE</span></div><span className="principle-annotation">A system designed to<br />stay out of the way.</span></div><div className="principle-copy"><div className="eyebrow">The SecureShare approach</div><h2>Security you can <em>understand.</em></h2><p>Sharing something sensitive should feel reassuring, not technical. SecureShare makes the important choices visible—who can access a file, for how long, and what happened along the way.</p><div className="principle-list"><div><Check size={15} /><span>Bearer links can be paused or revoked at any time.</span></div><div><Check size={15} /><span>Expiry dates are clear before you share.</span></div><div><Check size={15} /><span>Recipients see a plain explanation before proceeding.</span></div></div><Link href="/sign-in" className="text-action principle-cta">Open your workspace <ArrowRight size={15} /></Link></div></section>
      <section className="closing-section"><span className="closing-mark"><LockKeyhole size={19} /></span><div><div className="eyebrow">For the things that deserve care</div><h2>Make the handoff feel <em>right.</em></h2><p>Your private workspace is one sign-in away.</p></div><Link href="/sign-in" className="button button-light">Sign in to SecureShare <ArrowRight size={16} /></Link></section>
    </main><footer className="landing-footer"><Logo /><span>Private sharing, made human.</span><span>© SecureShare · Thoughtful access, by design.</span></footer>
  </div>;
}

function SignInPage() {
  return <div className="auth-wrap"><Link href="/" className="auth-brand"><Logo /></Link><div className="auth-aside"><span className="auth-illustration"><ShieldCheck size={32} /></span><div className="eyebrow">A private workspace</div><h1>Every handoff,<br /><em>in good hands.</em></h1><p>Sign in to manage the files and links you have chosen to share.</p><div className="auth-footer-note"><LockKeyhole size={14} /> Your workspace is for one administrator.</div></div><div className="auth-content"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}

function SignUpPage() {
  return <div className="auth-wrap"><Link href="/" className="auth-brand"><Logo /></Link><div className="auth-aside"><span className="auth-illustration"><KeyRound size={31} /></span><div className="eyebrow">An intentional beginning</div><h1>Set up your<br /><em>private desk.</em></h1><p>SecureShare is built around a single administrator, with no extra roles to manage.</p><div className="auth-footer-note"><ShieldCheck size={14} /> Your account is the key to your workspace.</div></div><div className="auth-content"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}

function HomeRedirect() {
  return <><Show when="signed-out"><HomePage /></Show><Show when="signed-in"><Redirect to="/dashboard" /></Show></>;
}

const AdminFrameContext = createContext(false);

function AdminGate({ children, active }: { children: ReactNode; active: string }) {
  const alreadyGated = useContext(AdminFrameContext);
  if (alreadyGated) return <>{children}</>;
  return <>
    <Show when="signed-in">
      <AdminFrame active={active}>
        <AdminFrameContextProvider>
          <AdminBootstrap>{children}</AdminBootstrap>
        </AdminFrameContextProvider>
      </AdminFrame>
    </Show>
    <Show when="signed-out">
      <div className="signed-out-gate"><Logo /><span className="eyebrow">Administrator access</span><h1>This workspace is private.</h1><p>Sign in to continue to your SecureShare workspace.</p><Link className="button button-primary" href="/sign-in">Administrator sign in <ArrowRight size={16} /></Link><Link href="/" className="text-action">Return to SecureShare</Link></div>
    </Show>
  </>;
}

function AdminFrameContextProvider({ children }: { children: ReactNode }) {
  return <AdminFrameContext.Provider value>{children}</AdminFrameContext.Provider>;
}

function AdminBootstrap({ children }: { children: ReactNode }) {
  const bootstrap = useGetAdminBootstrapState();
  const claim = useClaimInitialAdmin();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [claimed, setClaimed] = useState(false);
  useEffect(() => { if (bootstrap.data?.isAdmin) setClaimed(true); }, [bootstrap.data?.isAdmin]);
  if (bootstrap.isLoading) return <LoadingPanel label="Checking administrator access" />;
  if (bootstrap.isError) return <ErrorPanel message="Your administrator status could not be confirmed." retry={() => bootstrap.refetch()} />;
  if (!bootstrap.data?.isAdmin && bootstrap.data?.bootstrapAvailable && !claimed) return <div className="setup-card"><span className="setup-icon"><KeyRound size={23} /></span><div className="eyebrow">First-time setup</div><h2>Claim this private workspace</h2><p>There is no administrator yet. Add your display name to become the sole administrator for this SecureShare instance.</p><form onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; claim.mutate({ data: { displayName: name.trim() } }, { onSuccess: () => { setClaimed(true); client.invalidateQueries({ queryKey: getGetAdminBootstrapStateQueryKey() }); } }); }}><label htmlFor="admin-name">Display name</label><input id="admin-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required data-testid="input-admin-name" /><Button type="submit" disabled={claim.isPending || !name.trim()}>{claim.isPending ? 'Setting up…' : 'Claim administrator access'} <ArrowRight size={15} /></Button>{claim.isError && <p className="inline-error">Setup could not be completed. Please try again.</p>}</form></div>;
  if (!bootstrap.data?.isAdmin) return <div className="state-panel state-error"><span className="state-icon"><LockKeyhole size={19} /></span><div><strong>Administrator access is not available</strong><p>This account is not the workspace administrator, and initial setup has already been claimed.</p><Link className="text-action" href="/">Return to SecureShare <ArrowRight size={15} /></Link></div></div>;
  return <>{children}</>;
}

function DashboardPage() {
  const summary = useGetDashboardSummary();
  const activity = useListActivity();
  const files = useListFiles();
  const links = useListLinks();
  const recent: ActivityRecord[] = summary.data?.recentActivity || [];
  const refresh = () => { summary.refetch(); activity.refetch(); files.refetch(); links.refetch(); };
  if (summary.isLoading) return <AdminGate active="/dashboard"><LoadingPanel /></AdminGate>;
  if (summary.isError) return <AdminGate active="/dashboard"><ErrorPanel message="Dashboard totals are temporarily unavailable." retry={refresh} /></AdminGate>;
  const data = summary.data!;
  return <AdminGate active="/dashboard"><PageTitle eyebrow="YOUR PRIVATE WORKSPACE" title="Good to see you." description="A clear view of what you've shared, what was opened, and what needs your attention." action={<Link href="/links" className="button button-primary"><Plus size={16} /> Create a sharing link</Link>} />
    <div className="overview-note"><span><ShieldCheck size={18} /></span><div><strong>Your handoffs are under your control.</strong><small>Links can be paused or revoked any time you need.</small></div><span className="overview-ornament">SECURESHARE / ADMIN</span></div>
    <div className="metric-grid"><Metric icon={<FolderClosed size={18} />} label="Private files" value={data.fileCount} suffix="in your workspace" tint="sage" /><Metric icon={<Link2 size={18} />} label="Active links" value={data.activeLinkCount} suffix="currently available" tint="gold" /><Metric icon={<Eye size={18} />} label="File accesses" value={data.accessCount} suffix="all-time opens" tint="blue" /><Metric icon={<Users size={18} />} label="Submissions" value={data.submissionCount} suffix="shared back with you" tint="rose" /></div>
    <div className="dashboard-lower"><section className="panel recent-panel"><div className="panel-heading"><div><div className="eyebrow">A useful paper trail</div><h2>Recent access</h2></div><Link href="/activity" className="panel-link">View all <ArrowRight size={14} /></Link></div>{activity.isLoading ? <LoadingPanel label="Loading recent activity" /> : activity.isError ? <ErrorPanel message="Recent activity could not be loaded." retry={() => activity.refetch()} /> : recent.length ? <ActivityRows items={recent.slice(0, 6)} /> : <EmptyPanel icon={<Clock3 size={21} />} title="No one has opened a link yet" copy="When a recipient opens a shared file, you’ll see the time and link here." />}</section><section className="panel storage-panel"><div className="panel-heading"><div><div className="eyebrow">Workspace contents</div><h2>Your files</h2></div><Link href="/files" className="panel-link">Manage <ArrowRight size={14} /></Link></div><div className="storage-figure"><strong>{formatBytes(data.storageBytes)}</strong><span>stored privately</span></div><div className="storage-meter"><span style={{ width: `${Math.min(100, Math.max(data.storageBytes ? 5 : 0, data.storageBytes / (100 * 1024 * 1024) * 100))}%` }} /></div><div className="storage-foot"><span><HardDrive size={15} /> {files.data?.length ?? data.fileCount} files stored</span><span>Direct, private uploads</span></div><div className="storage-divider" /><div className="storage-link-count"><span className="tiny-lock"><LockKeyhole size={15} /></span><span><strong>{links.data?.length ?? data.activeLinkCount} handoff links</strong><small>Review, renew, or revoke access</small></span><Link href="/links" aria-label="Manage links" className="round-arrow"><ArrowRight size={15} /></Link></div></section></div>
  </AdminGate>;
}

function Metric({ icon, label, value, suffix, tint }: { icon: ReactNode; label: string; value: number; suffix: string; tint: string }) {
  return <article className="metric-card"><span className={`metric-icon tint-${tint}`}>{icon}</span><span className="metric-label">{label}</span><strong className="metric-value">{value.toLocaleString()}</strong><span className="metric-suffix">{suffix}</span><span className="metric-decoration" /></article>;
}

function FilesPage() {
  const query = useListFiles();
  const requestUrl = useRequestUploadUrl();
  const create = useCreateFile();
  const remove = useDeleteFile();
  const client = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file) return;
    const acceptedTypes = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
      'video/mp4', 'video/webm', 'video/quicktime', 'text/plain', 'text/csv',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
    if (file.size > 500 * 1024 * 1024 || !acceptedTypes.has(file.type)) {
      setUploadError(file.size > 500 * 1024 * 1024
        ? 'Choose a file that is 500 MB or smaller.'
        : 'That file type is not supported. Choose a document, image, or video.');
      return;
    }
    setUploadError('');
    setUploadName(file.name);
    setProgress(0);
    try {
      const signed = await requestUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' } });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signed.uploadURL);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload returned ${xhr.status}`));
        xhr.onerror = () => reject(new Error('The direct upload could not connect.'));
        xhr.send(file);
      });
      await create.mutateAsync({ data: { name: file.name, contentType: file.type || 'application/octet-stream', size: file.size, objectPath: signed.objectPath } });
      await Promise.all([client.invalidateQueries({ queryKey: getListFilesQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]);
      setProgress(null);
      setUploadName('');
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setUploadError('Upload did not finish. Your file was not added. Choose it again to retry.');
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }
  async function deleteFile(file: FileRecord) {
    if (!window.confirm(`Delete “${file.name}”? Any link containing it will lose this file.`)) return;
    await remove.mutateAsync({ fileId: file.id });
    await Promise.all([client.invalidateQueries({ queryKey: getListFilesQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }), client.invalidateQueries({ queryKey: getListLinksQueryKey() })]);
  }
  return <AdminGate active="/files"><PageTitle eyebrow="YOUR PRIVATE LIBRARY" title="Private files" description="Your originals stay in your workspace until you add them to a sharing link." action={<Button onClick={() => inputRef.current?.click()} disabled={progress !== null}><Upload size={16} /> Upload a file</Button>} />
    <section className="upload-banner"><div className="upload-banner-icon"><FileUp size={23} /></div><div className="upload-banner-copy"><strong>Bring a document in, keep it here.</strong><span>Files upload directly to private storage. Nothing becomes shareable until you make a link.</span></div><label className="file-picker-button" htmlFor="private-file-input"><Plus size={15} /> Choose file</label><input ref={inputRef} id="private-file-input" type="file" onChange={(event) => upload(event.target.files?.[0])} data-testid="input-private-file" /></section>
    {progress !== null && <div className="upload-progress-card"><div className="upload-progress-title"><span><LoaderCircle size={16} className="spin" /> Uploading {uploadName}</span><strong>{progress}%</strong></div><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><small>Sending file directly to private storage</small></div>}
    {uploadError && <div className="inline-alert"><XCircle size={16} /><span>{uploadError}</span><button onClick={() => setUploadError('')} aria-label="Dismiss upload error"><X size={15} /></button></div>}
    {query.isLoading ? <LoadingPanel label="Loading your private files" /> : query.isError ? <ErrorPanel message="Your file library could not be loaded." retry={() => query.refetch()} /> : query.data?.length ? <section className="panel file-list-panel"><div className="list-toolbar"><div><div className="eyebrow">PRIVATE STORAGE</div><strong>{query.data.length} {query.data.length === 1 ? 'file' : 'files'}</strong></div><span className="private-tag"><LockKeyhole size={13} /> Private</span></div><div className="file-list">{query.data.map((file) => <FileRow key={file.id} file={file} onDelete={() => deleteFile(file)} deleting={remove.isPending} />)}</div></section> : <EmptyPanel icon={<FolderClosed size={22} />} title="Your library is ready" copy="Upload a document to start your private file library." action={<Button onClick={() => inputRef.current?.click()}><Upload size={15} /> Upload your first file</Button>} />}
    {remove.isError && <p className="inline-error">This file could not be removed. Try again in a moment.</p>}
  </AdminGate>;
}

function FileRow({ file, onDelete, deleting }: { file: FileRecord; onDelete: () => void; deleting: boolean }) {
  const Icon = file.contentType.startsWith('image/') ? FileImage : file.contentType === 'application/pdf' ? FileText : FileIcon;
  return <article className="file-row" data-testid={`row-file-${file.id}`}><span className="file-type-icon"><Icon size={20} /></span><div className="file-row-main"><strong>{file.name}</strong><span>{file.contentType || 'Unknown file type'} <i /> {formatBytes(file.size)}</span></div><div className="file-row-shares"><strong>{file.shareCount}</strong><span>{file.shareCount === 1 ? 'link' : 'links'}</span></div><div className="file-row-date">{formatDate(file.createdAt)}</div><button className="icon-button delete-icon" aria-label={`Delete ${file.name}`} onClick={onDelete} disabled={deleting} data-testid={`button-delete-file-${file.id}`}><Trash2 size={16} /></button></article>;
}

function LinksPage() {
  const linksQuery = useListLinks();
  const filesQuery = useListFiles();
  const create = useCreateLink();
  const update = useUpdateLink();
  const remove = useDeleteLink();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('');
  const [allowSubmissions, setAllowSubmissions] = useState(false);
  const [createdUrl, setCreatedUrl] = useState('');
  const [formError, setFormError] = useState('');
  const canCreate = Boolean(title.trim() && selected.length);
  const createLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setFormError('');
    try {
      const item = await create.mutateAsync({ data: { title: title.trim(), fileIds: selected, expiresAt: expiry ? new Date(expiry).toISOString() : null, allowSubmissions } });
      const shareUrl = `${window.location.origin}${basePath}/share/${item.token}`;
      setCreatedUrl(shareUrl);
      setTitle(''); setSelected([]); setExpiry(''); setAllowSubmissions(false);
      await Promise.all([client.invalidateQueries({ queryKey: getListLinksQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]);
    } catch { setFormError('The link could not be created. Your files were not shared.'); }
  };
  const toggleActive = async (item: ShareLink) => {
    await update.mutateAsync({ linkId: item.id, data: { active: !item.active } });
    await client.invalidateQueries({ queryKey: getListLinksQueryKey() });
  };
  const toggleSubmissions = async (item: ShareLink) => {
    await update.mutateAsync({ linkId: item.id, data: { allowSubmissions: !item.allowSubmissions } });
    await client.invalidateQueries({ queryKey: getListLinksQueryKey() });
  };
  const deleteLink = async (item: ShareLink) => {
    if (!window.confirm(`Permanently delete the link “${item.title}”?`)) return;
    await remove.mutateAsync({ linkId: item.id });
    await Promise.all([client.invalidateQueries({ queryKey: getListLinksQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]);
  };
  const copyLink = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}${basePath}/share/${token}`);
    setCreatedUrl('copied');
    window.setTimeout(() => setCreatedUrl(''), 2200);
  };
  return <AdminGate active="/links"><PageTitle eyebrow="CONTROLLED ACCESS" title="Sharing links" description="Create a clear, revocable path to selected files. Each link carries only what you assign." action={<Button onClick={() => setOpen(!open)}><Plus size={16} /> New link</Button>} />
    {open && <section className="panel create-link-panel"><div className="panel-heading"><div><div className="eyebrow">NEW HANDOFF</div><h2>Choose what travels</h2></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close link form"><X size={17} /></button></div><form onSubmit={createLink} className="create-link-form"><label className="field-label">Link title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="For example, Q3 planning documents" required data-testid="input-link-title" /></label><fieldset className="file-selection"><legend>Files in this handoff <small>Choose one or more</small></legend>{filesQuery.isLoading ? <span className="subtle">Loading your file library…</span> : filesQuery.data?.length ? <div className="selection-list">{filesQuery.data.map((file) => <label key={file.id} className={`selection-row ${selected.includes(file.id) ? 'selected' : ''}`}><input type="checkbox" checked={selected.includes(file.id)} onChange={() => setSelected(selected.includes(file.id) ? selected.filter((id) => id !== file.id) : [...selected, file.id])} data-testid={`checkbox-file-${file.id}`} /><span className="selection-check"><Check size={12} /></span><FileText size={16} /><span className="selection-file-name">{file.name}</span><small>{formatBytes(file.size)}</small></label>)}</div> : <div className="selection-empty">Add a private file before creating a link. <Link href="/files" className="inline-link">Go to files <ArrowRight size={13} /></Link></div>}</fieldset><div className="link-settings"><label className="field-label">Link expires <span className="optional">Optional</span><input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} data-testid="input-link-expiry" /></label><label className="setting-toggle"><span className="toggle-mark"><Users size={17} /></span><span><strong>Allow recipient submissions</strong><small>Recipient can choose to send media back</small></span><input type="checkbox" checked={allowSubmissions} onChange={(event) => setAllowSubmissions(event.target.checked)} data-testid="checkbox-allow-submissions" /></label></div>{formError && <div className="inline-alert"><XCircle size={15} />{formError}</div>}<div className="form-actions"><Button kind="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!canCreate || create.isPending || !filesQuery.data?.length}>{create.isPending ? 'Creating…' : 'Create secure link'} <ArrowRight size={15} /></Button></div></form></section>}
    {createdUrl && createdUrl !== 'copied' && <div className="created-link-notice"><span className="notice-icon"><CheckCircle2 size={18} /></span><div><strong>Link ready to share</strong><small>{createdUrl}</small></div><Button kind="outline" onClick={() => copyLink(createdUrl.split('/').at(-1) || '')}><Copy size={14} /> Copy link</Button><button className="icon-button" aria-label="Dismiss created link" onClick={() => setCreatedUrl('')}><X size={15} /></button></div>}
    {createdUrl === 'copied' && <div className="copy-toast"><Check size={14} /> Sharing link copied to clipboard</div>}
    {linksQuery.isLoading ? <LoadingPanel label="Loading sharing links" /> : linksQuery.isError ? <ErrorPanel message="Your links could not be loaded." retry={() => linksQuery.refetch()} /> : linksQuery.data?.length ? <section className="link-cards">{linksQuery.data.map((item) => <LinkCard key={item.id} item={item} onToggle={() => toggleActive(item)} onSubmissionToggle={() => toggleSubmissions(item)} onDelete={() => deleteLink(item)} onCopy={() => copyLink(item.token)} pending={update.isPending || remove.isPending} />)}</section> : <EmptyPanel icon={<Link2 size={22} />} title="A link is the start of a handoff" copy={filesQuery.data?.length ? 'Choose a few files and create a private link you can revoke at any time.' : 'Upload a private file first, then choose exactly what to include in a handoff.'} action={<>{filesQuery.data?.length ? <Button onClick={() => setOpen(true)}><Plus size={15} /> Create your first link</Button> : <Link className="button button-primary" href="/files"><Upload size={15} /> Upload a file</Link>}</>} />}
    {(update.isError || remove.isError) && <p className="inline-error">That link could not be changed. Try again.</p>}
  </AdminGate>;
}

function LinkCard({ item, onToggle, onSubmissionToggle, onDelete, onCopy, pending }: { item: ShareLink; onToggle: () => void; onSubmissionToggle: () => void; onDelete: () => void; onCopy: () => void; pending: boolean }) {
  const expired = Boolean(item.expiresAt && new Date(item.expiresAt).getTime() < Date.now());
  const currentState = !item.active ? 'Revoked' : expired ? 'Expired' : 'Active';
  return <article className="link-card" data-testid={`card-link-${item.id}`}><div className="link-card-head"><span className={`link-state ${currentState.toLowerCase()}`}><i />{currentState}</span><button className="icon-button link-delete" onClick={onDelete} disabled={pending} aria-label={`Delete ${item.title}`} data-testid={`button-delete-link-${item.id}`}><Trash2 size={16} /></button></div><h2>{item.title}</h2><div className="link-token-row"><span className="token-icon"><Link2 size={14} /></span><code>/share/{item.token}</code><button className="icon-button" aria-label="Copy share link" onClick={onCopy} data-testid={`button-copy-link-${item.id}`}><Copy size={14} /></button></div><div className="link-card-files"><span className="eyebrow">IN THIS HANDOFF</span>{item.files.map((file) => <div className="mini-file" key={file.id}><FileIcon size={14} /><span>{file.name}</span><small>{formatBytes(file.size)}</small></div>)}</div><div className="link-card-facts"><span><Eye size={14} /><strong>{item.accessCount}</strong> opens</span><span><Clock3 size={14} />{item.expiresAt ? `Expires ${formatDate(item.expiresAt)}` : 'No expiry set'}</span></div><div className="link-card-settings"><label><span>Recipient submissions</span><input aria-label="Toggle recipient submissions" type="checkbox" checked={item.allowSubmissions} onChange={onSubmissionToggle} disabled={pending || !item.active || expired} data-testid={`toggle-submissions-${item.id}`} /></label><Button kind={item.active && !expired ? 'quiet' : 'outline'} onClick={onToggle} disabled={pending || expired} testId={`button-toggle-link-${item.id}`}>{item.active ? 'Revoke access' : 'Restore link'}</Button></div></article>;
}

function ActivityPage() {
  const query = useListActivity();
  const rows = query.data || [];
  return <AdminGate active="/activity"><PageTitle eyebrow="A USEFUL PAPER TRAIL" title="Access activity" description="A simple record of when recipients opened files through your links." action={<span className="private-tag"><ShieldCheck size={14} /> Private to you</span>} />
    <div className="activity-summary"><span className="summary-icon"><Activity size={18} /></span><span><strong>{rows.length}</strong><small>{rows.length === 1 ? 'record shown' : 'records shown'}</small></span><span className="summary-end">Timestamps are shown in your local time.</span></div>
    {query.isLoading ? <LoadingPanel label="Loading access activity" /> : query.isError ? <ErrorPanel message="Activity records could not be loaded." retry={() => query.refetch()} /> : rows.length ? <section className="panel activity-table"><div className="activity-table-head"><span>SHARED LINK</span><span>FILE OPENED</span><span>DATE & TIME</span></div><ActivityRows items={rows} detailed /></section> : <EmptyPanel icon={<Clock3 size={22} />} title="Your access history is quiet" copy="When a recipient opens a file, the time and file name will appear here." />}
  </AdminGate>;
}

function ActivityRows({ items, detailed = false }: { items: ActivityRecord[]; detailed?: boolean }) {
  return <div className="activity-list">{items.map((item) => <article className={`activity-row ${detailed ? 'activity-row-detailed' : ''}`} key={item.id} data-testid={`row-activity-${item.id}`}><div className="activity-link"><span className="activity-small-icon"><Link2 size={14} /></span><span><strong>{item.linkTitle}</strong>{!detailed && <small>{item.fileName}</small>}</span></div>{detailed && <div className="activity-file"><FileIcon size={15} />{item.fileName}</div>}<div className="activity-time"><span className="time-date">{formatDate(item.accessedAt)}</span><span>{formatTime(item.accessedAt)}</span></div></article>)}</div>;
}

function SubmissionsPage() {
  const query = useListSubmissions();
  const remove = useDeleteSubmission();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [submissionPreviewUrl, setSubmissionPreviewUrl] = useState('');
  const content = useGetSubmissionContent(selectedId, { query: { enabled: Boolean(selectedId), queryKey: getGetSubmissionContentQueryKey(selectedId) } });
  const rows = query.data || [];
  const current = rows.find((row) => row.id === selectedId);
  useEffect(() => {
    if (submissionPreviewUrl) URL.revokeObjectURL(submissionPreviewUrl);
    if (content.data && current?.contentType.startsWith('image/')) setSubmissionPreviewUrl(URL.createObjectURL(content.data));
    else setSubmissionPreviewUrl('');
    return () => { if (submissionPreviewUrl) URL.revokeObjectURL(submissionPreviewUrl); };
  }, [content.data, current?.contentType]);
  const deleteItem = async (item: SubmissionRecord) => {
    if (!window.confirm(`Delete recipient submission “${item.name}”? This permanently removes the submitted file.`)) return;
    await remove.mutateAsync({ submissionId: item.id });
    setSelectedId('');
    await Promise.all([client.invalidateQueries({ queryKey: getListSubmissionsQueryKey() }), client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() })]);
  };
  const download = async () => {
    if (!content.data || !current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(content.data);
    a.download = current.name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return <AdminGate active="/submissions"><PageTitle eyebrow="VOLUNTARY RETURN HANDOFFS" title="Submissions" description="Recipients choose what to send back. Review each item, then keep it or remove it." action={<span className="private-tag"><Users size={14} /> {rows.length} received</span>} />
    {query.isLoading ? <LoadingPanel label="Loading recipient submissions" /> : query.isError ? <ErrorPanel message="Recipient submissions could not be loaded." retry={() => query.refetch()} /> : rows.length ? <section className="submissions-layout"><div className="panel submissions-list"><div className="list-toolbar"><div><div className="eyebrow">RECENTLY RECEIVED</div><strong>{rows.length} {rows.length === 1 ? 'submission' : 'submissions'}</strong></div><span className="private-tag"><LockKeyhole size={12} /> Private</span></div>{rows.map((item) => <button className={`submission-row ${selectedId === item.id ? 'submission-row-active' : ''}`} key={item.id} onClick={() => setSelectedId(item.id)} data-testid={`button-view-submission-${item.id}`}><span className="submission-file-icon"><FileImage size={17} /></span><span className="submission-main"><strong>{item.name}</strong><small>Through {item.linkTitle}</small></span><span className="submission-date">{formatDate(item.createdAt)}</span><ChevronRight size={16} /></button>)}</div><div className="panel submission-detail">{current ? <><div className="detail-label">SUBMISSION DETAIL</div><div className="detail-file-icon"><FileImage size={27} /></div><h2>{current.name}</h2><p>Sent through <strong>{current.linkTitle}</strong></p><div className="detail-meta"><span>File type</span><strong>{current.contentType}</strong><span>File size</span><strong>{formatBytes(current.size)}</strong><span>Received</span><strong>{formatDate(current.createdAt)} · {formatTime(current.createdAt)}</strong></div>{content.isLoading ? <LoadingPanel label="Retrieving submission privately" /> : content.isError ? <div className="inline-alert"><XCircle size={15} />Preview unavailable. You can retry the file request.</div> : submissionPreviewUrl ? <img className="submission-preview" src={submissionPreviewUrl} alt={`Preview of ${current.name}`} /> : null}<div className="detail-actions"><Button kind="outline" onClick={() => content.refetch()} disabled={!selectedId}><Eye size={15} /> Load preview</Button><Button kind="primary" onClick={download} disabled={!content.data}><ArrowDownToLine size={15} /> Download</Button><Button kind="danger" onClick={() => deleteItem(current)} disabled={remove.isPending}><Trash2 size={15} /> Delete</Button></div></> : <div className="detail-empty"><span><FileImage size={22} /></span><strong>Select a submission</strong><p>Choose an item to review its details and content.</p></div>}</div></section> : <EmptyPanel icon={<Users size={22} />} title="Nothing has been sent back" copy="When a recipient chooses to submit media through a link, it will appear here for your review." />}
    {remove.isError && <p className="inline-error">This submission could not be deleted. Try again.</p>}
  </AdminGate>;
}

function PublicSharePage() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const query = useGetPublicShare(token);
  const [unlocked, setUnlocked] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [shareError, setShareError] = useState('');
  const [leave, setLeave] = useState(false);
  const expired = Boolean(query.data?.expiresAt && new Date(query.data.expiresAt).getTime() < Date.now());
  const enableCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError('This browser does not provide camera access. Try another browser or device.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
      setUnlocked(true);
    } catch (error) {
      setCameraError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Camera permission was not granted. Your files remain locked until permission is enabled.' : 'The camera could not be started. Your files remain locked; please retry or leave this page.');
    }
  };
  if (leave) return <div className="share-page"><div className="share-top"><Logo /></div><main className="share-centered"><span className="share-lock-large"><LockKeyhole size={25} /></span><div className="eyebrow">You can leave safely</div><h1>Nothing was opened.</h1><p>Your files remain locked. You may close this page.</p><Link className="text-action" href="/">Return to SecureShare <ArrowRight size={15} /></Link></main></div>;
  if (query.isLoading) return <ShareShell><LoadingPanel label="Checking this secure link" /></ShareShell>;
  if (query.isError) return <ShareShell><ShareUnavailable title="This link isn't available" copy="It may have been revoked, expired, or shared incorrectly. Ask the sender for a current link." /></ShareShell>;
  if (!query.data) return <ShareShell><ShareUnavailable title="This link isn't available" copy="There is no active handoff at this address." /></ShareShell>;
  if (expired) return <ShareShell><ShareUnavailable title="This link has expired" copy="The sender set an expiry date for this handoff. Contact them to request a new link." /></ShareShell>;
  if (!unlocked) return <ShareShell><div className="camera-consent-card"><div className="consent-mark"><Camera size={24} /></div><div className="eyebrow">A small step before viewing</div><h1>{query.data.title}</h1><p className="consent-intro">To continue, this educational demonstration asks for camera permission before showing shared files.</p><div className="permission-explainer"><span className="permission-shield"><ShieldCheck size={19} /></span><div><strong>Permission unlocks viewing only.</strong><p>SecureShare will immediately stop camera access after permission is confirmed. It never records or uploads from this permission step.</p></div></div>{cameraError && <div className="camera-error" role="alert"><XCircle size={16} />{cameraError}</div>}<Button onClick={enableCamera} className="enable-camera-button"><Camera size={17} /> Enable Camera and Continue</Button><Button kind="quiet" onClick={() => setLeave(true)} className="leave-share-button"><ArrowLeft size={15} /> Leave this page</Button><div className="consent-foot"><LockKeyhole size={13} /> No file is accessible until permission succeeds.</div></div></ShareShell>;
  return <ShareShell><div className="recipient-content"><div className="recipient-verified"><span><BadgeCheck size={16} /></span> Viewing enabled <span className="verified-rule" /><span className="recipient-expiry">{query.data.expiresAt ? `Expires ${formatDate(query.data.expiresAt)}` : 'No expiry set'}</span></div><div className="eyebrow">A PRIVATE HANDOFF</div><h1>{query.data.title}</h1><p className="recipient-intro">The sender has shared these files with you. Open or download only what you need.</p><div className="recipient-files">{query.data.files.map((file) => <RecipientFile key={file.id} token={token} file={file} unlocked={unlocked} />)}</div>{query.data.allowSubmissions && <RecipientSubmission token={token} onError={setShareError} />}{shareError && <div className="inline-alert"><XCircle size={15} />{shareError}</div>}<div className="recipient-footer"><ShieldCheck size={15} /> Shared with care through SecureShare <button onClick={() => setLeave(true)}>Leave</button></div></div></ShareShell>;
}

function ShareShell({ children }: { children: ReactNode }) {
  return <div className="share-page"><header className="share-top"><Link href="/" className="landing-brand"><Logo /></Link><div className="recipient-secure-label"><LockKeyhole size={13} /> SECURE HANDOFF</div></header><main className="share-main">{children}</main><footer className="share-foot"><span>SECURESHARE</span><span>Thoughtful access, by design.</span></footer></div>;
}

function ShareUnavailable({ title, copy }: { title: string; copy: string }) {
  return <div className="share-unavailable"><span className="unavailable-icon"><Link2 size={22} /></span><div className="eyebrow">HANDOFF NOT AVAILABLE</div><h1>{title}</h1><p>{copy}</p><Link className="text-action" href="/">Go to SecureShare <ArrowRight size={15} /></Link></div>;
}

function RecipientFile({ token, file, unlocked }: { token: string; file: { id: string; name: string; contentType: string; size: number }; unlocked: boolean }) {
  const content = useGetSharedFileContent(token, file.id, { query: { enabled: false, queryKey: getGetSharedFileContentQueryKey(token, file.id) } });
  const download = useDownloadSharedFile(token, file.id, { query: { enabled: false, queryKey: getDownloadSharedFileQueryKey(token, file.id) } });
  const [error, setError] = useState('');
  const openContent = async () => {
    setError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Allow pop-ups for this site, then try opening the file again.');
      return;
    }
    tab.opener = null;
    try {
      const result = await content.refetch();
      if (!result.data) {
        tab.close();
        setError('This file could not be opened. Please try again.');
        return;
      }
      const url = URL.createObjectURL(result.data);
      tab.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      tab.close();
      setError('This file could not be opened. Please try again.');
    }
  };
  const downloadContent = async () => {
    setError('');
    try {
      const result = await download.refetch();
      if (!result.data) {
        setError('This file could not be downloaded. Please try again.');
        return;
      }
      const url = URL.createObjectURL(result.data);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.name; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError('This file could not be downloaded. Please try again.');
    }
  };
  return <article className="recipient-file" data-testid={`recipient-file-${file.id}`}><span className="recipient-file-icon"><FileText size={19} /></span><span className="recipient-file-detail"><strong>{file.name}</strong><small>{file.contentType} <i /> {formatBytes(file.size)}</small></span><div className="recipient-file-actions"><Button kind="quiet" disabled={!unlocked || content.isFetching} onClick={openContent}>{content.isFetching ? 'Opening…' : 'Open'} <ExternalLink size={14} /></Button><Button kind="outline" disabled={!unlocked || download.isFetching} onClick={downloadContent}><ArrowDownToLine size={15} /> Download</Button></div>{error && <span className="recipient-file-error">{error}</span>}</article>;
}

function RecipientSubmission({ token, onError }: { token: string; onError: (error: string) => void }) {
  const requestUrl = useRequestSubmissionUploadUrl();
  const create = useCreateSubmission();
  const client = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [consented, setConsented] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRecordingRef = useRef(false);
  useEffect(() => { if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current; }, [capturing]);
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  const startCamera = async () => {
    setCameraError('');
    setSelectedFile(null);
    setConsented(false);
    setPreviewUrl('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setCameraError('Camera capture is not supported on this device. You can choose a file instead.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setCapturing(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraError('Camera permission was not granted. No media was recorded or sent.');
    }
  };
  const beginRecording = () => {
    const stream = streamRef.current;
    if (!stream || !window.MediaRecorder) return;
    chunksRef.current = [];
    cancelRecordingRef.current = false;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = () => {
      if (cancelRecordingRef.current) {
        chunksRef.current = [];
        setRecording(false);
        return;
      }
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new globalThis.File([blob], `recipient-recording-${new Date().toISOString().slice(0, 10)}.${extension}`, { type: blob.type });
      setSelectedFile(file);
      const url = URL.createObjectURL(blob);
      setPreviewUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
      setRecording(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setCapturing(false);
    };
    recorder.start();
    setRecording(true);
  };
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); };
  const stopCamera = () => {
    if (recorderRef.current?.state === 'recording') {
      cancelRecordingRef.current = true;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCapturing(false); setRecording(false);
  };
  const submit = async () => {
    if (!selectedFile || !consented) return;
    if (selectedFile.size > 50 * 1024 * 1024) {
      onError('Media must be 50 MB or smaller.');
      return;
    }
    onError('');
    setProgress(0);
    try {
      const signed = await requestUrl.mutateAsync({ token, data: { name: selectedFile.name, size: selectedFile.size, contentType: selectedFile.type || 'application/octet-stream' } });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signed.uploadURL);
        xhr.setRequestHeader('Content-Type', selectedFile.type || 'application/octet-stream');
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'));
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(selectedFile);
      });
      await create.mutateAsync({ token, data: { name: selectedFile.name, contentType: selectedFile.type || 'application/octet-stream', size: selectedFile.size, objectPath: signed.objectPath } });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetPublicShareQueryKey(token) }),
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ]);
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(''); setSelectedFile(null); setConsented(false); setProgress(null);
      onError('');
      window.alert('Your submission was sent to the sender.');
    } catch {
      setProgress(null);
      onError('The submission could not be completed. Your chosen file has not been confirmed as sent.');
    }
  };
  return <section className="recipient-submission"><div className="submission-section-heading"><span className="submission-section-icon"><Users size={18} /></span><div><div className="eyebrow">OPTIONAL · YOUR CHOICE</div><h2>Send something back</h2><p>The sender has invited you to submit media. Nothing is captured or uploaded without your action.</p></div></div><div className="submission-choice-row"><label className="recipient-file-picker"><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(event) => { if (capturing) stopCamera(); const file = event.target.files?.[0] || null; setSelectedFile(file); setConsented(false); setPreviewUrl(file ? URL.createObjectURL(file) : ''); }} data-testid="input-recipient-file" /><Upload size={16} /><span>Choose a photo or video</span></label><span className="choice-or">or</span><Button kind="outline" onClick={startCamera} disabled={capturing}><Camera size={16} /> Use camera</Button></div>{cameraError && <div className="camera-error"><XCircle size={15} />{cameraError}</div>}{capturing && <div className="capture-panel"><div className="capture-preview-wrap"><video ref={videoRef} autoPlay playsInline muted className="capture-video" /><span className={`recording-badge ${recording ? 'recording-live' : ''}`}><i />{recording ? 'Recording' : 'Camera preview'}</span></div><div className="capture-controls">{recording ? <Button kind="danger" onClick={stopRecording}><span className="record-stop-square" /> Stop recording</Button> : <Button onClick={beginRecording}><Video size={15} /> Start recording</Button>}<Button kind="quiet" onClick={stopCamera}>Stop camera</Button></div></div>}{previewUrl && <div className="submission-preview-wrap">{selectedFile?.type.startsWith('image/') ? <img className="submission-preview-image" src={previewUrl} alt="Preview of selected media" /> : <video className="submission-preview-video" controls src={previewUrl} />}<div className="preview-file-caption"><CheckCircle2 size={14} /> Review your media before sending. It will not be uploaded unless you confirm.</div><Button kind="quiet" onClick={() => { setPreviewUrl(''); setSelectedFile(null); setConsented(false); }}>Discard media</Button></div>}{selectedFile && <div className="submission-confirm"><div className="chosen-media"><FileImage size={17} /><span><strong>{selectedFile.name}</strong><small>{formatBytes(selectedFile.size)} · ready to send</small></span><button onClick={() => { setPreviewUrl(''); setSelectedFile(null); setConsented(false); }} aria-label="Remove selected submission"><X size={15} /></button></div><label className="confirmation-check"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} data-testid="checkbox-confirm-submission" /><span>I chose this media and want to send it to the person who shared this link.</span></label><Button onClick={submit} disabled={!consented || progress !== null}>{progress !== null ? `Sending ${progress}%` : 'Confirm and send submission'} <ArrowRight size={15} /></Button>{progress !== null && <div className="progress-track"><i style={{ width: `${progress}%` }} /></div>}</div>}</section>;
}

function DashboardRoute() {
  return <AdminGate active="/dashboard"><DashboardPage /></AdminGate>;
}

function FilesRoute() {
  return <AdminGate active="/files"><FilesPage /></AdminGate>;
}

function LinksRoute() {
  return <AdminGate active="/links"><LinksPage /></AdminGate>;
}

function ActivityRoute() {
  return <AdminGate active="/activity"><ActivityPage /></AdminGate>;
}

function SubmissionsRoute() {
  return <AdminGate active="/submissions"><SubmissionsPage /></AdminGate>;
}

function AppRouter() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/dashboard" component={DashboardRoute} />
    <Route path="/files" component={FilesRoute} />
    <Route path="/links" component={LinksRoute} />
    <Route path="/activity" component={ActivityRoute} />
    <Route path="/submissions" component={SubmissionsRoute} />
    <Route path="/share/:token" component={PublicSharePage} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== id) client.clear();
    previous.current = id;
  }), [addListener, client]);
  return null;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your private workspace' } }, signUp: { start: { title: 'Create your SecureShare account', subtitle: 'Set up your private administrator workspace' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheInvalidator /><AppRouter /></QueryClientProvider>
  </ClerkProvider>;
}

function App() {
  return <TooltipProvider><WouterRouter base={basePath}><ClerkRoutes /></WouterRouter><Toaster /></TooltipProvider>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 0; size >= 1024 && index < units.length - 1; index++) { size /= 1024; unit = units[index + 1]; }
  return `${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export default App;
