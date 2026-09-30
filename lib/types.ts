export type View = 'admin' | 'display';
export type DisplayMode = 'live' | 'subtitles';

export type SessionState =
  | 'WAITING'
  | 'LISTENING'
  | 'PROCESSING'
  | 'TRANSLATING'
  | 'DISPLAYING'
  | 'SILENT'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'MICROPHONE_ERROR'
  | 'PERMISSION_REQUIRED'
  | 'ENDED';

export interface TranslationPair {
  arabic: string;
  urdu: string;
}

export type TranslateMode = 'interim' | 'final';

export interface InterimState {
  arabic: string;
  urdu: string;
  isActive: boolean;
}

export type SpeechRecognitionEventLike = Event & {
  results: {
    [index: number]: {
      [index: number]: { transcript: string; isFinal?: boolean };
    };
  };
  resultIndex: number;
};

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onstart?: (() => void) | null;
  start: () => void;
  stop: () => void;
};
