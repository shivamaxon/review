import Link from 'next/link';
export default function NotFound(){return <main className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-semibold">This page isn’t available</h1><p className="mt-3">The link may be out of date, or the record may be outside your access.</p><Link className="touch-button mt-5 border" href="/">Go to my home</Link></main>;}
