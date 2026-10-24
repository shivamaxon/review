'use client';
import { useRef, useState, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start: () => void;
    stop: () => void;
    onresult: ((event: {
        results: {
            length: number;
            [n: number]: {
                isFinal: boolean;
                [n: number]: {
                    transcript: string;
                };
            };
        };
        resultIndex: number;
    }) => void) | null;
    onerror: ((e: {
        error: string;
    }) => void) | null;
    onend: (() => void) | null;
};
type SpeechWindow = Window & {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
};
export function VoiceRemark({ value, onChange, label = 'Remark' }: {
    value: string;
    onChange: (s: string) => void;
    label?: string;
}) {
    const [lang, setLang] = useState('en-IN');
    const [listening, setListening] = useState(false);
    const [message, setMessage] = useState('');
    const instance = useRef<Recognition | null>(null);
    const current = useRef(value);
    useEffect(() => { current.current = value; }, [value]);
    useEffect(() => () => instance.current?.stop(), []);
    function start() {
        const w = window as SpeechWindow;
        const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (!Constructor) {
            setMessage('Voice is not supported in this browser. You can type your remark below.');
            return;
        }
        const recognition = new Constructor();
        instance.current = recognition;
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.onresult = e => { let text = ''; for (let i = e.resultIndex; i < e.results.length; i++)
            if (e.results[i].isFinal)
                text += e.results[i][0].transcript + ' '; if (text)
            onChange((current.current + ' ' + text).trim()); };
        recognition.onerror = e => { setMessage(e.error === 'not-allowed' ? 'Allow microphone access in your browser, or type your remark.' : 'Voice paused. Your typed words are safe; try again or type.'); setListening(false); };
        recognition.onend = () => { setListening(false); setMessage(previous => previous === 'Listening… tap Stop when finished.' ? 'Voice stopped. You can edit the words before saving.' : previous); };
        try {
            recognition.start();
            setListening(true);
            setMessage('Listening… tap Stop when finished.');
        }
        catch {
            setMessage('Could not start the microphone. Try again or type.');
        }
    }
    return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><label className="field-label" htmlFor="entry-remark">{label}</label><div className="flex gap-2"><select aria-label="Voice language" value={lang} onChange={e => setLang(e.target.value)} className="form-input w-auto"><option value="en-IN">English</option><option value="hi-IN">हिन्दी</option></select><button type="button" className={`touch-button gap-2 ${listening ? 'bg-red-100 text-red-800' : 'bg-slate-100'}`} onClick={() => listening ? instance.current?.stop() : start()}>{listening ? <Square size={18}/> : <Mic size={18}/>} {listening ? 'Stop' : 'Speak'}</button></div></div><textarea id="entry-remark" className="form-input min-h-28 resize-y" value={value} onChange={e => onChange(e.target.value)} placeholder="What happened? What should we do next?"/>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}</div>;
}
