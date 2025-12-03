import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- IMPORTS DE FIREBASE ---
import { auth, db, storage, messaging } from './firebaseConfig';
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from 'firebase/auth';
import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    setDoc,
    getDoc,
    arrayUnion,
    writeBatch
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage';
import { getToken } from 'firebase/messaging';


// --- DEFINIZIONE DI TIPI ---
interface SubTask {
  id: string;
  text: string;
  completed: boolean;
  photo?: string;
}

interface Task {
  id: string;
  text: string;
  date: string; // Creation date string YYYY-MM-DD
  completed: boolean;
  important: boolean;
  subtasks: SubTask[];
  isBreakingDown?: boolean;
  dueDate?: string;
  photo?: string;
  note?: string;
  owner: string;
  apartment?: string; // Field for apartment assignment
  createdAt?: any; // Firestore Timestamp
  completedAt?: any; // Firestore Timestamp
}

interface Suggestions {
  stagionali: string[];
  contestuali: string[];
}

interface Transaction {
    id: string;
    type: 'deposit' | 'expense';
    amount: number;
    description: string;
    date: any; // Timestamp
    photo?: string;
    addedBy: string; // 'Admin' or 'Elias'
}

type ModalState =
    | { type: null }
    | { type: 'task'; data?: Partial<Task> }
    | { type: 'photo'; data: string }
    | { type: 'suggestion'; data?: never }
    | { type: 'transaction'; };

// --- CONSTANTS ---
const ALL_USERNAMES = ['Angelo', 'Juan', 'Elias'];

const APARTMENTS = [
    "Superior Borgo Pio",
    "Deluxe Borgo Pio",
    "Superior Via delle Mura",
    "First Via delle Mura",
    "Int. 6 Via Ostiense",
    "Int. 8 Via Ostiense",
    "Int. 9 Via Ostiense",
    "Int. 19 Via Ostiense",
    "Via Lattanzio",
    "Via Gaetta",
    "Via Arco di Parma",
    "Via Angelo Emo"
];

// --- CHECKLISTS DI MANUTENZIONE ---
const MONTHLY_CHECKLIST_ITEMS = [
    "Controllo generale filtri aria condizionata",
    "Verifica funzionamento estintori e luci di emergenza",
    "Ispezione e pulizia aree comuni",
    "Test scarichi e rubinetti per perdite"
];
const QUARTERLY_CHECKLIST_ITEMS = [
    "Pulizia approfondita unità HVAC",
    "Test completo sistema allarmi antincendio",
    "Controllo e pulizia grondaie e pluviali",
    "Verifica pressione impianto idraulico",
    "Ispezione tetto e infissi esterni"
];


// --- HELPER FUNCTIONS ---
const toDateString = (date: Date): string => date.toISOString().split('T')[0];
const getFormattedDate = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('it-IT', options);
};
const getUrgencyClass = (dueDate: string | undefined, currentDate: Date): string => {
    if (!dueDate) return '';
    const today = new Date(currentDate); today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return 'urgency-high'; // Red
    if (diffDays <= 3) return 'urgency-medium'; // Yellow
    if (diffDays > 5) return 'urgency-low'; // Green
    return ''; // Neutral for 4-5 days
};


// --- COMPONENTE LOGIN ---
const LoginPage = ({ onDemoLogin }: { onDemoLogin: () => void }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [rememberMe, setRememberMe] = useState(true);
    const [loading, setLoading] = useState(false);
    const emailInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { emailInputRef.current?.focus(); }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
            await signInWithEmailAndPassword(auth, email, password);
        } catch (err) {
            setError('Credenziali non valide. Riprova.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-form">
                <h2>Accesso</h2>
                <form onSubmit={handleSubmit}>
                    <input ref={emailInputRef} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="login-input" disabled={loading}/>
                    <div className="password-input-container">
                        <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" className="login-input" disabled={loading}/>
                        <button type="button" className="show-password-btn" onClick={() => setShowPassword(!showPassword)} disabled={loading}>{showPassword ? '🙈' : '👁️'}</button>
                    </div>
                    <div className="remember-me-container">
                        <input type="checkbox" id="remember-me" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} disabled={loading}/>
                        <label htmlFor="remember-me">Ricordami</label>
                    </div>
                    {error && <p className="error-message">{error}</p>}
                    <button type="submit" className="login-button" disabled={loading}>
                        {loading ? <div className="spinner"></div> : 'Accedi'}
                    </button>
                    <div className="demo-buttons">
                        <button type="button" className="demo-btn" onClick={onDemoLogin}>Acceso Demo (Admin)</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- MODAL COMPONENT ---
const TaskModal = ({ user, viewingUser, taskToEdit, onClose, onSaveTask, onCreateChecklistTask }: { user: any, viewingUser: string, taskToEdit: Partial<Task>, onClose: () => void, onSaveTask: (data: { text: string; dueDate?: string; apartment?: string; assignedTo?: string }, task?: Partial<Task>) => void, onCreateChecklistTask: (type: 'monthly' | 'quarterly', dueDate: string, assignedTo: string) => void }) => {
  const isEditing = 'id' in taskToEdit;
  const [text, setText] = useState(isEditing ? taskToEdit.text || '' : '');
  const [dueDate, setDueDate] = useState(isEditing ? taskToEdit.dueDate || '' : '');
  const [apartment, setApartment] = useState(isEditing ? taskToEdit.apartment || '' : '');
  
  // Default Assignment Logic
  const [assignedTo, setAssignedTo] = useState(() => {
      if (isEditing) return taskToEdit.owner!;
      // REQUEST: Angelo's default assignment option is Elias
      if (user.name === 'Angelo') return 'Elias';
      if (user.role === 'admin') return viewingUser;
      return user.name;
  });
  
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Permission Logic for assigning tasks
  // Admin & Angelo: Can assign to Everyone.
  // Elias: Can assign to Juan and Elias.
  // Juan: Cannot assign to anyone (including self - can't create).
  const canAssignToOthers = user.role === 'admin' || user.name === 'Angelo' || user.name === 'Elias';
  
  // Who can the current user assign to?
  const assignableUsers = useMemo(() => {
      if (user.role === 'admin' || user.name === 'Angelo') return ALL_USERNAMES;
      if (user.name === 'Elias') return ['Elias', 'Juan'];
      return []; // Juan cannot assign to anyone
  }, [user]);

  useEffect(() => {
      // Logic for pre-selecting apartment if passed via taskToEdit (e.g. context-aware add)
      if (taskToEdit.apartment) {
          setApartment(taskToEdit.apartment);
      }
  }, [taskToEdit]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (text.trim()) {
      onSaveTask({ 
          text: text.trim(), 
          dueDate: dueDate || undefined, 
          apartment: apartment || undefined,
          assignedTo: canAssignToOthers ? assignedTo : user.name 
        }, isEditing ? taskToEdit : undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    else if (e.key === 'Escape') onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>{isEditing ? 'Modifica Attività' : 'Nuova Attività'}</h3>
        <input ref={inputRef} type="text" className="modal-input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} placeholder="Cosa c'è da fare?" />
        
        <div className="form-group">
        <label htmlFor="due-date">Data di Scadenza</label>
        <input id="due-date" type="date" className="modal-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={toDateString(new Date())} />
        </div>

        {/* User Assignment Selector */}
        {!isEditing && canAssignToOthers && assignableUsers.length > 0 && (
            <div className="form-group">
                <label htmlFor="assign-user">Assegna a:</label>
                <select id="assign-user" className="modal-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                    {assignableUsers.map(u => (
                        <option key={u} value={u}>{u}</option>
                    ))}
                </select>
            </div>
        )}

        {/* Apartment Selector - Visible for everyone now */}
        <div className="form-group">
            <label htmlFor="apartment-select">Assegna Appartamento (Opzionale)</label>
            <select id="apartment-select" className="modal-input" value={apartment} onChange={(e) => setApartment(e.target.value)}>
                <option value="">Nessun Appartamento (Generale)</option>
                {APARTMENTS.map((apt) => (
                    <option key={apt} value={apt}>{apt}</option>
                ))}
            </select>
        </div>

        {/* Maintenance Checklists - Visible for Admin & Elias ONLY when assigned to Juan */}
        {(user.role === 'admin' || user.name === 'Elias') && assignedTo === 'Juan' && !isEditing && (
            <div className="checklist-actions">
                <p>O imposta una scadenza e crea una checklist di manutenzione:</p>
                <button className="checklist-btn monthly" onClick={() => onCreateChecklistTask('monthly', dueDate, assignedTo)} disabled={!dueDate} title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}>Crea Manutenzione Mensile</button>
                <button className="checklist-btn quarterly" onClick={() => onCreateChecklistTask('quarterly', dueDate, assignedTo)} disabled={!dueDate} title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}>Crea Manutenzione Trimestrale</button>
            </div>
        )}
        <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onClose}>Annulla</button>
          <button className="modal-btn-add" onClick={handleSubmit}>{isEditing ? 'Salva' : 'Aggiungi'}</button>
        </div>
      </div>
    </div>
  );
};

// --- TRANSACTION MODAL (For Finance) ---
const TransactionModal = ({ user, onClose, onSave }: { user: any, onClose: () => void, onSave: (data: Partial<Transaction>, file?: File) => void }) => {
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [type, setType] = useState<'deposit' | 'expense'>(user.role === 'admin' ? 'deposit' : 'expense');
    const [file, setFile] = useState<File | null>(null);

    const handleSubmit = () => {
        if (!amount || isNaN(Number(amount))) return;
        onSave({
            type,
            amount: Number(amount),
            description: description || (type === 'deposit' ? 'Ricarica Fondo' : 'Spesa'),
            addedBy: user.name
        }, file || undefined);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h3>{user.role === 'admin' ? 'Gestione Fondi' : 'Aggiungi Spesa'}</h3>
                
                {user.role === 'admin' && (
                    <div className="form-group" style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
                        <button type="button" className={`toggle-btn ${type === 'deposit' ? 'active' : ''}`} onClick={() => setType('deposit')}>Aggiungi Fondo (+)</button>
                        <button type="button" className={`toggle-btn ${type === 'expense' ? 'active-red' : ''}`} onClick={() => setType('expense')}>Registra Spesa (-)</button>
                    </div>
                )}

                <input type="number" className="modal-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Importo (€)" />
                <input type="text" className="modal-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrizione (es. Ferramenta, Ricarica...)" />
                
                {(type === 'expense' || user.role === 'admin') && (
                    <div className="form-group">
                        <label>Allega Foto/Ricevuta (Opzionale)</label>
                        <input type="file" accept="image/*" onChange={(e) => e.target.files && setFile(e.target.files[0])} className="modal-input" />
                    </div>
                )}

                <div className="modal-actions">
                    <button className="modal-btn-cancel" onClick={onClose}>Annulla</button>
                    <button className="modal-btn-add" onClick={handleSubmit}>Salva</button>
                </div>
            </div>
        </div>
    );
};

// --- FINANCE WIDGET ---
const FinanceWidget = ({ balance, onOpenModal, isAdmin, onReset }: { balance: number, onOpenModal: () => void, isAdmin: boolean, onReset: () => void }) => {
    return (
        <div className="finance-widget">
            <div className={`balance-box ${balance >= 0 ? 'positive' : 'negative'}`}>
                <span className="balance-label">Fondo Casa</span>
                <span className="balance-amount">€ {balance.toFixed(2)}</span>
            </div>
            <div style={{display: 'flex', gap: '10px', width: '100%'}}>
                <button className="finance-btn" onClick={onOpenModal}>
                    Gestisci / Aggiungi
                </button>
                {isAdmin && (
                    <button className="finance-btn" style={{width: 'auto', backgroundColor: '#c82333', borderColor: '#a31c29'}} onClick={onReset} title="Elimina tutte le transazioni e resetta il fondo">
                        🗑️
                    </button>
                )}
            </div>
        </div>
    );
};

// --- TRANSACTION LIST COMPONENT ---
const TransactionList = ({ transactions, onShowPhoto }: { transactions: Transaction[], onShowPhoto: (url: string) => void }) => {
    if (transactions.length === 0) return null;
    return (
        <div className="recent-transactions">
            <h4>Storico Transazioni</h4>
             <ul className="transaction-list-ul">
                 {transactions.map(t => (
                     <li key={t.id} className={`transaction-list-item ${t.type}`}>
                         <div className="trans-row">
                            <span className="trans-amount">{t.type === 'deposit' ? '+' : '-'} €{t.amount.toFixed(2)}</span>
                            <span className="trans-desc">{t.description}</span>
                         </div>
                         <div className="trans-row meta">
                            <span className="trans-date">
                                {t.date && typeof t.date.toDate === 'function' ? t.date.toDate().toLocaleDateString('it-IT') : 'Oggi'}
                            </span>
                            {t.photo && (
                                <button className="photo-btn-small" onClick={(e) => { e.stopPropagation(); onShowPhoto(t.photo!); }}>
                                    📷 Vedi Foto
                                </button>
                            )}
                         </div>
                     </li>
                 ))}
             </ul>
        </div>
    );
};

// --- SUGGESTIONS MODAL ---
const SuggestionsModal = ({ isOpen, isLoading, suggestions, onAdd, onClose }: { isOpen: boolean, isLoading: boolean, suggestions: Suggestions, onAdd: (text: string) => void, onClose: () => void }) => {
  if (!isOpen) return null;
  const hasContextual = suggestions.contestuali && suggestions.contestuali.length > 0;
  const hasSeasonal = suggestions.stagionali && suggestions.stagionali.length > 0;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>✨ Suggerimenti AI</h3>
        {isLoading ? ( <p className="loading-suggestions">Ricerca di suggerimenti in corso...</p> ) : (
          <div className="suggestions-container">
            {!hasContextual && !hasSeasonal && <p>Nessun suggerimento trovato.</p>}
            {hasContextual && (
              <>
                <h4 className="suggestions-category-header">In Base alle Tue Attività</h4>
                <ul className="suggestions-list">
                  {suggestions.contestuali.map((suggestion, index) => (
                    <li key={`ctx-${index}`} className="suggestion-item">
                      <span>{suggestion}</span>
                      <button onClick={() => onAdd(suggestion)} className="add-suggestion-btn" aria-label={`Aggiungi task: ${suggestion}`}>+</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {hasSeasonal && (
              <>
                <h4 className="suggestions-category-header">Suggerimenti del Mese</h4>
                <ul className="suggestions-list">
                  {suggestions.stagionali.map((suggestion, index) => (
                    <li key={`sea-${index}`} className="suggestion-item">
                      <span>{suggestion}</span>
                      <button onClick={() => onAdd(suggestion)} className="add-suggestion-btn" aria-label={`Aggiungi task: ${suggestion}`}>+</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
         <div className="modal-actions">
          <button className="modal-btn-cancel" onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  );
};

// --- PHOTO PREVIEW MODAL ---
const PhotoPreviewModal = ({ imageUrl, onClose }: { imageUrl: string, onClose: () => void }) => {
    return (
        <div className="modal-overlay photo-modal-overlay" onClick={onClose}>
            <div className="photo-modal-content" onClick={(e) => e.stopPropagation()}>
                <img src={imageUrl} alt="Anteprima" />
                <button onClick={onClose} className="modal-btn-cancel">Chiudi</button>
            </div>
        </div>
    );
};

// --- SINGLE TASK ITEM COMPONENT (REUSABLE) ---
interface TaskItemProps {
    task: Task;
    viewingUser: string;
    currentUserRole?: string;
    handleToggleTask: (id: string) => void;
    handleToggleImportance: (id: string) => void;
    handleToggleSubtask?: (taskId: string, subtaskId: string) => void;
    handleDeleteTask: (id: string) => void;
    handleBreakdownTask?: (taskId: string) => void;
    handlePhotoUpload: (taskId: string, file: File) => void;
    handleSubtaskPhotoUpload?: (taskId: string, subtaskId: string, file: File) => void;
    setModalState: (state: ModalState) => void;
    handleNoteSave: (taskId: string, note: string) => void;
    uploadingPhotoId: string | null;
}

const TaskItem: React.FC<TaskItemProps> = ({ 
    task, viewingUser, currentUserRole,
    handleToggleTask, handleToggleImportance, handleToggleSubtask, handleDeleteTask, 
    handleBreakdownTask, handlePhotoUpload, handleSubtaskPhotoUpload, setModalState, 
    handleNoteSave, uploadingPhotoId 
}) => {
    const [isNoteExpanded, setIsNoteExpanded] = useState(false);
    const [editingNote, setEditingNote] = useState('');
    
    // Urgency calculation
    const urgencyClass = getUrgencyClass(task.dueDate, new Date());

    const handleNoteToggle = () => {
        if (isNoteExpanded) { setIsNoteExpanded(false); }
        else { setEditingNote(task.note || ''); setIsNoteExpanded(true); }
    };

    const saveNote = () => {
        handleNoteSave(task.id, editingNote);
        setIsNoteExpanded(false);
    };

    return (
        <li className={`task-item ${task.completed ? 'completed' : ''} ${task.important ? 'important' : ''} ${task.isBreakingDown ? 'loading' : ''} ${urgencyClass}`}>
            <button className={`importance-btn ${task.important ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleToggleImportance(task.id); }}>★</button>
            <div className="task-content-wrapper">
                <div className="task-main" onClick={() => handleToggleTask(task.id)}>
                    <div className={`checkbox ${task.completed ? 'checked' : ''}`}>{task.completed && '✓'}</div>
                    <div className="task-text-container">
                        <span className="task-text">{task.text}</span>
                        <span className="task-meta">Creato il: {task.date}</span>
                        {task.completed && task.completedAt && (
                             <span className="task-meta completed-date">
                                Completato il: {task.completedAt?.toDate ? task.completedAt.toDate().toLocaleDateString('it-IT') : new Date().toLocaleDateString('it-IT')}
                             </span>
                        )}
                        {task.dueDate && (<span className={`task-due-date ${urgencyClass}`}>Scadenza: {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}</span>)}
                    </div>
                </div>
                
                {/* Subtasks */}
                {task.subtasks && task.subtasks.length > 0 && (
                    <ul className="subtask-list">
                      {task.subtasks.map(subtask => (
                        <li key={subtask.id} className={`subtask-item ${subtask.completed ? 'completed' : ''}`} >
                          <div className='subtask-content' onClick={() => handleToggleSubtask && handleToggleSubtask(task.id, subtask.id)}>
                            <div className={`checkbox ${subtask.completed ? 'checked' : ''}`}>{subtask.completed && '✓'}</div>
                            <span className="task-text">{subtask.text}</span>
                          </div>
                            {ALL_USERNAMES.includes(viewingUser) && subtask.photo && (<img src={subtask.photo} alt="Anteprima sotto-attività" className="task-photo-thumbnail subtask-photo-thumbnail" onClick={() => setModalState({ type: 'photo', data: subtask.photo! })} />)}
                        </li>
                      ))}
                    </ul>
                )}

                {/* Note Section */}
                {isNoteExpanded && (
                    <div className="note-section">
                        <textarea className="note-textarea" value={editingNote} onChange={(e) => setEditingNote(e.target.value)} placeholder="Aggiungi una nota..." />
                        <button className="note-save-btn" onClick={saveNote}>Salva</button>
                    </div>
                )}

                {/* Photo Upload / Preview */}
                {uploadingPhotoId === task.id ? (
                    <div className="spinner"></div>
                ) : task.photo ? (
                    <img src={task.photo} alt="Anteprima" className="task-photo-thumbnail" onClick={() => setModalState({ type: 'photo', data: task.photo! })} />
                ) : (
                    <label className="action-btn photo-upload-btn">
                        📷
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files && handlePhotoUpload(task.id, e.target.files[0])} />
                    </label>
                )}
            </div>
            
            <div className="task-actions">
                <button className={`action-btn note-toggle-btn ${isNoteExpanded ? 'expanded' : ''}`} onClick={handleNoteToggle}>📝</button>
                {handleBreakdownTask && <button className="action-btn breakdown-btn" onClick={() => handleBreakdownTask(task.id)} disabled={task.isBreakingDown}>🪄</button>}
                <button className="action-btn edit-btn" onClick={() => setModalState({ type: 'task', data: task })}>✏️</button>
                <button className="action-btn delete-btn" onClick={() => handleDeleteTask(task.id)}>&times;</button>
            </div>
        </li>
    );
};


// --- ADMIN DASHBOARD ---
const AdminDashboard = ({ 
  allTasks, viewingUser, handleToggleTask, handleToggleSubtask, handleToggleImportance, handleDeleteTask, handleBreakdownTask, handleUpdateNote, handleSubtaskPhotoUpload, setModalState,
  transactions, balance, onOpenTransactionModal, onResetFinance
}: {
  allTasks: Record<string, Task[]>,
  viewingUser: string,
  handleToggleTask: (id: string) => void,
  handleToggleSubtask: (taskId: string, subtaskId: string) => void,
  handleToggleImportance: (id: string) => void,
  handleDeleteTask: (id: string) => void,
  handleBreakdownTask: (taskId: string) => void,
  handleUpdateNote: (taskId: string, note: string) => void,
  handleSubtaskPhotoUpload: (taskId: string, subtaskId: string, file: File) => void,
  setModalState: (state: ModalState) => void,
  transactions: Transaction[],
  balance: number,
  onOpenTransactionModal: () => void,
  onResetFinance: () => void
}) => {
  const [taskFilter, setTaskFilter] = useState<'da_fare' | 'completate' | 'tutte'>('da_fare');
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  // Replaced expandedApartments with activeApartment for Card view
  const [activeApartment, setActiveApartment] = useState<string | null>(null);

  const { globalStats, priorityTasks } = useMemo(() => {
    const allUserTasks: Task[] = Object.values(allTasks).flat();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = toDateString(sevenDaysAgo);
    const stats = {
      globalStats: {
        totalPending: allUserTasks.filter(t => !t.completed).length,
        completedLastWeek: allUserTasks.filter(t => t.completed && t.date >= sevenDaysAgoStr).length,
      },
      priorityTasks: allUserTasks.filter(t => t.important && !t.completed),
    };
    return stats;
  }, [allTasks]);

  const viewingUserTasks = useMemo(() => {
    const tasks = (allTasks[viewingUser] || []).slice().sort((a, b) => {
        // Sort: Newest created first (by date string desc, or timestamp desc if available)
        // If date is YYYY-MM-DD
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return 0;
    });
    return tasks;
  }, [allTasks, viewingUser]);

  const handlePhotoUpload = async (taskId: string, file: File) => {
    setUploadingPhotoId(taskId);
    try {
      const storageRef = ref(storage, `tasks/${taskId}/${file.name}_${Date.now()}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'tasks', taskId), { photo: downloadURL });
    } catch (e) { console.error(e); } finally { setUploadingPhotoId(null); }
  };

  const filteredTasks = viewingUserTasks.filter(t => {
    if (taskFilter === 'da_fare') return !t.completed;
    if (taskFilter === 'completate') return t.completed;
    return true;
  });

  // Group tasks for ALL users (Requested: "los recuadros... les tiene que aparecer a todos los usuarios")
  const { apartmentTasks, generalTasks } = useMemo(() => {
      // Logic runs for everyone now
      const aptTasks: Record<string, Task[]> = {};
      const genTasks: Task[] = [];

      filteredTasks.forEach(task => {
          if (task.apartment && APARTMENTS.includes(task.apartment)) {
              if (!aptTasks[task.apartment]) aptTasks[task.apartment] = [];
              aptTasks[task.apartment].push(task);
          } else {
              genTasks.push(task);
          }
      });
      return { apartmentTasks: aptTasks, generalTasks: genTasks };
  }, [filteredTasks]);


  return (
    <div className="admin-dashboard">
      <div className="stats-grid">
        <div className="stat-widget">
          <h3>In Sospeso (Totale)</h3>
          <p className="stat-value">{globalStats.totalPending}</p>
        </div>
        <div className="stat-widget">
          <h3>Completate (7gg)</h3>
          <p className="stat-value">{globalStats.globalStats ? globalStats.globalStats.completedLastWeek : 0}</p>
        </div>
      </div>

      <div className="widget-container">
        <div className="widget">
          <h3>⚠️ Priorità Alta</h3>
          {priorityTasks.length === 0 ? <p className="no-tasks">Nessuna urgenza.</p> : (
            <ul className="priority-tasks-list">
              {priorityTasks.map(t => (
                <li key={t.id}>
                  <strong>{t.owner}:</strong> {t.text}
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Finance Widget if viewing Elias */}
        {viewingUser === 'Elias' && (
             <div className="widget">
                 <h3>Gestione Fondo Elias</h3>
                 <FinanceWidget balance={balance} onOpenModal={onOpenTransactionModal} isAdmin={true} onReset={onResetFinance}/>
                 <TransactionList transactions={transactions} onShowPhoto={(url) => setModalState({ type: 'photo', data: url })} />
             </div>
        )}
      </div>

      <div className="task-management-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{margin: 0}}>Gestione Attività: {viewingUser}</h2>
            {/* Added apartment context to New Task */}
            <button className="add-btn" onClick={() => setModalState({ type: 'task', data: { apartment: activeApartment || undefined } })}>+ Nuova Attività</button>
        </div>
        <div className="task-filters">
            <button className={taskFilter === 'da_fare' ? 'active' : ''} onClick={() => setTaskFilter('da_fare')}>Da Fare</button>
            <button className={taskFilter === 'completate' ? 'active' : ''} onClick={() => setTaskFilter('completate')}>Completate</button>
            <button className={taskFilter === 'tutte' ? 'active' : ''} onClick={() => setTaskFilter('tutte')}>Tutte</button>
        </div>

        <div className="apartments-container">
            {/* APARTMENT GRID / DETAIL VIEW - Now visible for everyone */}
            {!activeApartment ? (
                /* GRID VIEW */
                <div className="apartment-grid">
                    {APARTMENTS.map(apt => {
                        const count = apartmentTasks[apt]?.length || 0;
                        return (
                            <div key={apt} className="apartment-card" onClick={() => setActiveApartment(apt)}>
                                <h4>{apt}</h4>
                                <span className="task-count-badge">{count} attività</span>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* DETAIL VIEW */
                <div className="apartment-detail-view">
                        <button className="back-btn" onClick={() => setActiveApartment(null)}>← Torna ai dipartimenti</button>
                        <h3>{activeApartment}</h3>
                        <ul className="task-list apartment-task-list">
                        {(!apartmentTasks[activeApartment] || apartmentTasks[activeApartment].length === 0) ? (
                            <p className="no-tasks-apt">Nessuna attività assegnata a questo appartamento.</p>
                        ) : (
                            apartmentTasks[activeApartment].map(task => (
                                <TaskItem 
                                    key={task.id}
                                    task={task}
                                    viewingUser={viewingUser}
                                    currentUserRole="admin"
                                    handleToggleTask={handleToggleTask}
                                    handleToggleImportance={handleToggleImportance}
                                    handleToggleSubtask={handleToggleSubtask}
                                    handleDeleteTask={handleDeleteTask}
                                    handleBreakdownTask={handleBreakdownTask}
                                    handlePhotoUpload={handlePhotoUpload}
                                    handleSubtaskPhotoUpload={handleSubtaskPhotoUpload}
                                    setModalState={setModalState}
                                    handleNoteSave={handleUpdateNote}
                                    uploadingPhotoId={uploadingPhotoId}
                                />
                            ))
                        )}
                    </ul>
                </div>
            )}
            
            {!activeApartment && generalTasks.length > 0 && (
                <>
                    <div className="section-title">Altre Manutenzioni / Generali</div>
                    <ul className="task-list">
                        {generalTasks.map(task => (
                            <TaskItem 
                                key={task.id}
                                task={task}
                                viewingUser={viewingUser}
                                currentUserRole="admin"
                                handleToggleTask={handleToggleTask}
                                handleToggleImportance={handleToggleImportance}
                                handleToggleSubtask={handleToggleSubtask}
                                handleDeleteTask={handleDeleteTask}
                                handleBreakdownTask={handleBreakdownTask}
                                handlePhotoUpload={handlePhotoUpload}
                                handleSubtaskPhotoUpload={handleSubtaskPhotoUpload}
                                setModalState={setModalState}
                                handleNoteSave={handleUpdateNote}
                                uploadingPhotoId={uploadingPhotoId}
                            />
                        ))}
                    </ul>
                </>
            )}
        </div>
      </div>
    </div>
  );
};


// --- MAIN APP COMPONENT ---
const App = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Add logging out state to prevent render issues during sign out
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  const [tasks, setTasks] = useState<Task[]>([]); // Current user's tasks
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({}); // For Admin
  const [viewingUser, setViewingUser] = useState<string>('');
  const [modalState, setModalState] = useState<ModalState>({ type: null });
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Suggestions>({ stagionali: [], contestuali: [] });
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  
  // Transactions State (Elias)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balance, setBalance] = useState(0);

  // State for User Dashboard (Apartment Grid View)
  const [activeApartment, setActiveApartment] = useState<string | null>(null);
  
  // REQUEST: Filter for all users
  const [userTaskFilter, setUserTaskFilter] = useState<'da_fare' | 'completate' | 'tutte'>('da_fare');

  const handleDemoLogin = () => {
      // Demo Admin
      setUser({ uid: 'demo-admin', email: 'admin@test.com', role: 'admin', name: 'Admin' });
      setViewingUser('Angelo'); // REQUEST: Admin default view is Angelo
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        let role = 'user';
        let name = 'Utente';
        
        if (u.email === 'admin@test.com') { role = 'admin'; name = 'Admin'; }
        else if (u.email === 'juan@test.com') { role = 'user'; name = 'Juan'; }
        else if (u.email === 'elias@test.com') { role = 'user'; name = 'Elias'; }
        else if (u.email === 'angelo@test.com') { role = 'user'; name = 'Angelo'; } // Added Angelo
        
        setUser({ uid: u.uid, email: u.email, role, name });
        // REQUEST: Admin default view is Angelo
        setViewingUser(role === 'admin' ? 'Angelo' : name); 
      } else {
        // If not logged in via Firebase, we might be in demo mode. 
        // If user is already set by handleDemoLogin, don't nullify immediately if loading is false.
        // But for strict auth flow:
        if (!user) setUser(null); 
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []); // Remove user dependency to avoid loop, let handleDemoLogin handle manual set

  // Listen for Tasks
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'tasks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      if (user.role === 'admin') {
        const grouped: Record<string, Task[]> = {};
        ALL_USERNAMES.forEach(u => grouped[u] = []);
        fetchedTasks.forEach(t => { if (grouped[t.owner] || ALL_USERNAMES.includes(t.owner)) {
             if(!grouped[t.owner]) grouped[t.owner] = [];
             grouped[t.owner].push(t); 
        }});
        setAllTasks(grouped);
      } else {
        setTasks(fetchedTasks.filter(t => t.owner === user.name).sort((a, b) => {
            // Sort Newest First
             if (a.date !== b.date) return b.date.localeCompare(a.date);
            return 0;
        }));
      }
    });
    return () => unsubscribe();
  }, [user]);

  // Listen for Transactions
  useEffect(() => {
      if (!user) return;
      const q = query(collection(db, 'transactions'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          const trans = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
          // Sort by date desc
          trans.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
          setTransactions(trans);
          
          const total = trans.reduce((acc, curr) => {
              return curr.type === 'deposit' ? acc + curr.amount : acc - curr.amount;
          }, 0);
          setBalance(total);
      });
      return () => unsubscribe();
  }, [user]);

  // --- HANDLERS ---
  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
        await signOut(auth);
    } catch (e) {
        console.error("Logout error:", e);
    }
    // Reloading immediately to clear all state
    window.location.reload(); 
  };
  
  const handleSaveTask = async (data: { text: string; dueDate?: string; apartment?: string; assignedTo?: string }, taskToEdit?: Partial<Task>) => {
    try {
      if (taskToEdit && taskToEdit.id) {
        await updateDoc(doc(db, 'tasks', taskToEdit.id), { 
            text: data.text, 
            dueDate: data.dueDate || null,
            apartment: data.apartment || null,
            owner: data.assignedTo || taskToEdit.owner
        });
      } else {
        // Determine owner based on permissions in TaskModal
        const owner = data.assignedTo || user.name;
        
        await addDoc(collection(db, 'tasks'), {
          text: data.text,
          completed: false,
          important: false,
          date: toDateString(new Date()),
          dueDate: data.dueDate || null,
          apartment: data.apartment || null,
          owner: owner,
          subtasks: [],
          createdAt: serverTimestamp()
        });
      }
      setModalState({ type: null });
    } catch (e) { console.error("Error saving task: ", e); }
  };

  const handleSaveTransaction = async (data: Partial<Transaction>, file?: File) => {
      try {
          let photoUrl = '';
          if (file) {
              const storageRef = ref(storage, `receipts/${Date.now()}_${file.name}`);
              await uploadBytes(storageRef, file);
              photoUrl = await getDownloadURL(storageRef);
          }
          
          await addDoc(collection(db, 'transactions'), {
              ...data,
              photo: photoUrl,
              date: serverTimestamp()
          });
          setModalState({ type: null });
      } catch (e: any) { 
          console.error(e);
          alert("Errore durante il salvataggio: " + e.message);
      }
  };

  // REQUEST: Reset Fund and Transactions
  const handleResetFinance = async () => {
      if(confirm("Sei sicuro di voler ELIMINARE TUTTE le transazioni e resettare il fondo? Questa azione è irreversibile.")) {
          try {
              // Delete all documents in transactions collection
              // Note: Client side batch delete. For large collections, use Cloud Functions.
              const batch = writeBatch(db);
              transactions.forEach(t => {
                  batch.delete(doc(db, 'transactions', t.id));
              });
              await batch.commit();
          } catch(e) { console.error("Error resetting finance:", e); }
      }
  };

  const handleCreateChecklistTask = async (type: 'monthly' | 'quarterly', dueDate: string, assignedTo: string) => {
      if (!dueDate) return;
      const targetUser = assignedTo; // Admin/Elias assigns to this user
      const title = type === 'monthly' ? "Manutenzione Mensile" : "Manutenzione Trimestrale";
      const items = type === 'monthly' ? MONTHLY_CHECKLIST_ITEMS : QUARTERLY_CHECKLIST_ITEMS;
      
      try {
          // Create main task
          const taskRef = await addDoc(collection(db, 'tasks'), {
              text: `${title} - ${new Date(dueDate).toLocaleDateString('it-IT', {month: 'long'})}`,
              completed: false,
              important: true, // Maintenance is usually important
              date: toDateString(new Date()),
              dueDate: dueDate,
              owner: targetUser,
              subtasks: items.map(item => ({ id: Date.now().toString() + Math.random(), text: item, completed: false })),
              createdAt: serverTimestamp()
          });
          setModalState({ type: null });
      } catch(e) { console.error(e); }
  };

  const handleDeleteTask = async (id: string) => {
    if (confirm('Sei sicuro di voler eliminare questa attività?')) {
      await deleteDoc(doc(db, 'tasks', id));
    }
  };

  const handleToggleTask = async (id: string) => {
    const task = (user.role === 'admin' ? allTasks[viewingUser] : tasks).find(t => t.id === id);
    if (task) {
        const isCompleting = !task.completed;
        await updateDoc(doc(db, 'tasks', id), { 
            completed: isCompleting,
            completedAt: isCompleting ? serverTimestamp() : null
        });
    }
  };

  const handleToggleImportance = async (id: string) => {
    const task = (user.role === 'admin' ? allTasks[viewingUser] : tasks).find(t => t.id === id);
    if (task) await updateDoc(doc(db, 'tasks', id), { important: !task.important });
  };

  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const taskList = user.role === 'admin' ? allTasks[viewingUser] : tasks;
    const task = taskList.find(t => t.id === taskId);
    if (task) {
        const newSubtasks = task.subtasks.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s);
        await updateDoc(doc(db, 'tasks', taskId), { subtasks: newSubtasks });
    }
  };

  const handleNoteSave = async (taskId: string, note: string) => {
      await updateDoc(doc(db, 'tasks', taskId), { note });
  };

  const handlePhotoUpload = async (taskId: string, file: File) => {
    setUploadingPhotoId(taskId);
    try {
      const storageRef = ref(storage, `tasks/${taskId}/${file.name}_${Date.now()}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'tasks', taskId), { photo: downloadURL });
    } catch (e) { console.error(e); } finally { setUploadingPhotoId(null); }
  };

  // --- AI LOGIC (Simulated or Real) ---
  const handleFetchSuggestions = async () => {
    // Reuse existing logic or mock
    setIsSuggestionsLoading(true);
    setModalState({ type: 'suggestion' });
    setTimeout(() => {
        setAiSuggestions({
            stagionali: ["Pulizia grondaie", "Controllo riscaldamento"],
            contestuali: ["Comprare vernice per ritocchi", "Controllare scorta lampadine"]
        });
        setIsSuggestionsLoading(false);
    }, 1500);
  };
  
  const handleBreakdownTask = async (taskId: string) => {
      // Mock AI Breakdown
      const taskList = user.role === 'admin' ? allTasks[viewingUser] : tasks;
      const task = taskList.find(t => t.id === taskId);
      if(!task) return;
      
      await updateDoc(doc(db, 'tasks', taskId), { isBreakingDown: true });
      setTimeout(async () => {
          const mockSubtasks = [
              { id: '1', text: 'Step 1: Ispezionare', completed: false },
              { id: '2', text: 'Step 2: Acquistare materiale', completed: false },
              { id: '3', text: 'Step 3: Eseguire lavoro', completed: false }
          ];
          await updateDoc(doc(db, 'tasks', taskId), { subtasks: mockSubtasks, isBreakingDown: false });
      }, 2000);
  };

  // --- RENDER HELPERS ---
  
  // Dashboard logic for ANY logged-in user (grouped by apartments)
  const renderUserDashboard = () => {
      const apartmentTasks: Record<string, Task[]> = {};
      const generalTasks: Task[] = [];
      
      // Filter based on user selection
      const filteredUserTasks = tasks.filter(t => {
          if (userTaskFilter === 'da_fare') return !t.completed;
          if (userTaskFilter === 'completate') return t.completed;
          return true;
      });

      // Sort tasks Newest First
      const sortedTasks = [...filteredUserTasks].sort((a,b) => b.date.localeCompare(a.date));

      sortedTasks.forEach(task => {
          if (task.apartment && APARTMENTS.includes(task.apartment)) {
              if (!apartmentTasks[task.apartment]) apartmentTasks[task.apartment] = [];
              apartmentTasks[task.apartment].push(task);
          } else {
              generalTasks.push(task);
          }
      });

      return (
          <div className="apartments-container">
             {/* REQUEST: Filters for normal users */}
             <div className="task-filters" style={{marginBottom: '20px', justifyContent: 'center'}}>
                <button className={userTaskFilter === 'da_fare' ? 'active' : ''} onClick={() => setUserTaskFilter('da_fare')}>Da Fare</button>
                <button className={userTaskFilter === 'completate' ? 'active' : ''} onClick={() => setUserTaskFilter('completate')}>Completate</button>
                <button className={userTaskFilter === 'tutte' ? 'active' : ''} onClick={() => setUserTaskFilter('tutte')}>Tutte</button>
             </div>

             {!activeApartment ? (
                 <div className="apartment-grid">
                     {APARTMENTS.map(apt => {
                         // Count total tasks for this apartment regardless of current filter to show "activity load"
                         // OR count based on filter? Usually better to count pending.
                         // Let's count based on the current filter view to match what they see inside.
                         const count = apartmentTasks[apt]?.length || 0;
                         return (
                             <div key={apt} className="apartment-card" onClick={() => setActiveApartment(apt)}>
                                 <h4>{apt}</h4>
                                 <span className="task-count-badge">{count} attività</span>
                             </div>
                         );
                     })}
                 </div>
             ) : (
                <div className="apartment-detail-view">
                    <button className="back-btn" onClick={() => setActiveApartment(null)}>← Torna ai dipartimenti</button>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                        <h3 style={{margin: 0, border: 'none'}}>{activeApartment}</h3>
                        {/* REQUEST: Pre-select apartment when adding task from here */}
                        {user.name !== 'Juan' && (
                            <button className="add-btn" style={{fontSize: '0.9rem', padding: '8px 12px'}} onClick={() => setModalState({ type: 'task', data: { apartment: activeApartment || undefined } })}>
                                + Nuova Attività Qui
                            </button>
                        )}
                    </div>
                     <ul className="task-list apartment-task-list">
                         {(!apartmentTasks[activeApartment] || apartmentTasks[activeApartment].length === 0) ? (
                             <p className="no-tasks-apt">Nessuna attività con questo filtro.</p>
                         ) : (
                             apartmentTasks[activeApartment].map(task => (
                                <TaskItem 
                                    key={task.id} 
                                    task={task} 
                                    viewingUser={user.name} 
                                    handleToggleTask={handleToggleTask}
                                    handleToggleImportance={handleToggleImportance}
                                    handleToggleSubtask={handleToggleSubtask}
                                    handleDeleteTask={handleDeleteTask}
                                    handleBreakdownTask={handleBreakdownTask}
                                    handlePhotoUpload={handlePhotoUpload}
                                    setModalState={setModalState}
                                    handleNoteSave={handleNoteSave}
                                    uploadingPhotoId={uploadingPhotoId}
                                />
                             ))
                         )}
                     </ul>
                 </div>
             )}
             
             {!activeApartment && generalTasks.length > 0 && (
                 <>
                    <div className="section-title">Generali</div>
                    <ul className="task-list">
                        {generalTasks.map(task => (
                            <TaskItem 
                                key={task.id} 
                                task={task} 
                                viewingUser={user.name} 
                                handleToggleTask={handleToggleTask}
                                handleToggleImportance={handleToggleImportance}
                                handleToggleSubtask={handleToggleSubtask}
                                handleDeleteTask={handleDeleteTask}
                                handleBreakdownTask={handleBreakdownTask}
                                handlePhotoUpload={handlePhotoUpload}
                                setModalState={setModalState}
                                handleNoteSave={handleNoteSave}
                                uploadingPhotoId={uploadingPhotoId}
                            />
                        ))}
                    </ul>
                 </>
             )}
          </div>
      );
  };


  if (loading || isLoggingOut) return <div className="loading-screen">Caricamento...</div>;
  if (!user) return <LoginPage onDemoLogin={handleDemoLogin} />;

  return (
    <div className="app-container">
      <header className="header">
        <h1>{user.role === 'admin' ? 'Admin Dashboard' : `Ciao, ${user.name}`}</h1>
        <div className="controls">
          {user.role === 'admin' && (
            <select className="user-selector" value={viewingUser} onChange={(e) => setViewingUser(e.target.value)}>
              {ALL_USERNAMES.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <button className="logout-btn" onClick={handleLogout}>Esci</button>
        </div>
      </header>

      {user.role === 'admin' ? (
        <AdminDashboard 
            allTasks={allTasks} 
            viewingUser={viewingUser}
            handleToggleTask={handleToggleTask}
            handleToggleSubtask={handleToggleSubtask}
            handleToggleImportance={handleToggleImportance}
            handleDeleteTask={handleDeleteTask}
            handleBreakdownTask={handleBreakdownTask}
            handleUpdateNote={handleNoteSave}
            handleSubtaskPhotoUpload={() => {}} 
            setModalState={setModalState}
            transactions={transactions}
            balance={balance}
            onOpenTransactionModal={() => setModalState({type: 'transaction'})}
            onResetFinance={handleResetFinance}
        />
      ) : (
        <main>
           <div className="date-navigation">
                <button className="nav-btn">‹</button>
                <div className="date-display">
                    <h2 className="date-header">{getFormattedDate(new Date())}</h2>
                    <button className="today-btn">Oggi</button>
                </div>
                <button className="nav-btn">›</button>
            </div>
            
            {user.name === 'Elias' && (
                <div style={{marginBottom: '20px'}}>
                     <FinanceWidget balance={balance} onOpenModal={() => setModalState({type: 'transaction'})} isAdmin={false} onReset={() => {}} />
                     <TransactionList transactions={transactions} onShowPhoto={(url) => setModalState({ type: 'photo', data: url })} />
                </div>
            )}

            {/* Juan cannot add tasks, so we hide controls for him */}
            {user.name !== 'Juan' && (
                <div className="task-actions-bar" style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
                    <button className="suggest-btn" onClick={handleFetchSuggestions}>✨ Suggeriscimi</button>
                    {/* REQUEST: Context aware - if activeApartment is null, undefined is passed */}
                    <button className="add-btn" onClick={() => setModalState({ type: 'task', data: { apartment: activeApartment || undefined } })}>+ Nuova Attività</button>
                </div>
            )}

            {/* Always use the Apartment Grid Dashboard for all users now */}
            {renderUserDashboard()}
        </main>
      )}

      {/* MODALS */}
      {modalState.type === 'task' && (
        <TaskModal 
            user={user}
            viewingUser={viewingUser}
            taskToEdit={modalState.data || {}} 
            onClose={() => setModalState({ type: null })} 
            onSaveTask={handleSaveTask}
            onCreateChecklistTask={handleCreateChecklistTask}
        />
      )}
      
      {modalState.type === 'transaction' && (
          <TransactionModal 
            user={user}
            onClose={() => setModalState({type: null})}
            onSave={handleSaveTransaction}
          />
      )}

      <SuggestionsModal 
        isOpen={modalState.type === 'suggestion'} 
        isLoading={isSuggestionsLoading} 
        suggestions={aiSuggestions} 
        onAdd={(text) => handleSaveTask({ text })} 
        onClose={() => setModalState({ type: null })} 
      />

      {modalState.type === 'photo' && (
        <PhotoPreviewModal imageUrl={modalState.data} onClose={() => setModalState({ type: null })} />
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
