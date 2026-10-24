import {requireProfile} from '@/lib/auth';
import {AccountBoundary} from '@/components/associate/account-boundary';
import {AppShell} from '@/components/app-shell';
export default async function AppLayout({children}:{children:React.ReactNode}){const profile=await requireProfile();return <AppShell profile={profile}><AccountBoundary owner={profile.id}/>{children}</AppShell>;}
