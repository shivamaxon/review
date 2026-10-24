import {AssociateRuntime} from '@/components/associate/runtime';
import {loadAssociateData} from '@/lib/associate/data';
export default async function AssociateLayout({children}:{children:React.ReactNode}){return <AssociateRuntime data={await loadAssociateData()}>{children}</AssociateRuntime>;}
