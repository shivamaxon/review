'use client';
import {useEffect} from 'react';
import {CURRENT_OWNER} from '@/lib/associate/storage';
export function AccountBoundary({owner}:{owner:string}){useEffect(()=>{if(localStorage.getItem(CURRENT_OWNER)!==owner)localStorage.removeItem(CURRENT_OWNER);},[owner]);return null;}
