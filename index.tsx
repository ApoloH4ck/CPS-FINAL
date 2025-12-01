import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- IMPORTS DE FIREBASE ---
import { auth, db, storage, messaging } from './firebaseConfig.js';
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
    arrayUnion
} from 'firebase/firestore';
import {
    ref,
    uploadBytes,
    getDownloadURL
} from 'firebase/storage';
import { getToken } from 'firebase/messaging';


// --- DEFINIZIONE DI TIPI (IDs CORREGIDOS A STRING) ---
interface SubTask {
  id: string;
  text: string;
  completed: boolean;
  photo?: string;
}

interface Task {
  id: string;
  text: string;
  date: string;
  completed: boolean;
  important: boolean;
  subtasks: SubTask[];
  isBreakingDown?: boolean;
  dueDate?: string;
  photo?: string;
  note?: string;
  owner: string;
  apartment?: string; // New field for apartment assignment
}

interface Suggestions {
  stagionali: string[];
  contestuali: string[];
}

type ModalState =
    | { type: null }
    | { type: 'task'; data?: Partial<Task> }
    | { type: 'photo'; data: string }
    | { type: 'suggestion'; data?: never };

// --- CONSTANTS ---
const ALL_USERNAMES = ['Angelo', 'Juan', 'Matteo', 'Elias'];

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
    "Via Arco di Parma"
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
const LoginPage = ({ onDemoLogin, onDemoJuanLogin }: { onDemoLogin: () => void, onDemoJuanLogin: () => void }) => {
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
                </form>
            </div>
        </div>
    );
};


// --- MODAL COMPONENT ---
const TaskModal = ({ user, viewingUser, taskToEdit, onClose, onSaveTask, onCreateChecklistTask }: { user: any, viewingUser: string, taskToEdit: Partial<Task>, onClose: () => void, onSaveTask: (data: { text: string; dueDate?: string; apartment?: string }, task?: Partial<Task>) => void, onCreateChecklistTask: (type: 'monthly' | 'quarterly', dueDate: string) => void }) => {
  const isEditing = 'id' in taskToEdit;
  const [text, setText] = useState(isEditing ? taskToEdit.text || '' : '');
  const [dueDate, setDueDate] = useState(isEditing ? taskToEdit.dueDate || '' : '');
  const [apartment, setApartment] = useState(isEditing ? taskToEdit.apartment || '' : '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (text.trim()) {
      onSaveTask({ text: text.trim(), dueDate: dueDate || undefined, apartment: apartment || undefined }, isEditing ? taskToEdit : undefined);
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
        
        {user.role === 'admin' && (
          <div className="form-group">
            <label htmlFor="due-date">Data di Scadenza</label>
            <input id="due-date" type="date" className="modal-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={toDateString(new Date())} />
          </div>
        )}

        {/* Selector de Departamento */}
        {user.role === 'admin' && (
            <div className="form-group">
                <label htmlFor="apartment-select">Assegna Appartamento (Opzionale)</label>
                <select id="apartment-select" className="modal-input" value={apartment} onChange={(e) => setApartment(e.target.value)}>
                    <option value="">Nessun Appartamento (Generale)</option>
                    {APARTMENTS.map((apt) => (
                        <option key={apt} value={apt}>{apt}</option>
                    ))}
                </select>
            </div>
        )}

        {user.role === 'admin' && viewingUser === 'Juan' && !isEditing && (
            <div className="checklist-actions">
                <p>O imposta una scadenza e crea una checklist di manutenzione:</p>
                <button className="checklist-btn monthly" onClick={() => onCreateChecklistTask('monthly', dueDate)} disabled={!dueDate} title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}>Crea Manutenzione Mensile</button>
                <button className="checklist-btn quarterly" onClick={() => onCreateChecklistTask('quarterly', dueDate)} disabled={!dueDate} title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}>Crea Manutenzione Trimestrale</button>
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
                <img src={imageUrl} alt="Prova del lavoro" />
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
                            {/* Allow upload for subtasks only if logic provided (AdminDashboard) - simplifying for user view */}
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
  allTasks, viewingUser, handleToggleTask, handleToggleSubtask, handleToggleImportance, handleDeleteTask, handleBreakdownTask, handleUpdateNote, handleSubtaskPhotoUpload, setModalState 
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
}) => {
  const [taskFilter, setTaskFilter] = useState<'da_fare' | 'completate' | 'tutte'>('da_fare');
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  const [expandedApartments, setExpandedApartments] = useState<Record<string, boolean>>({});

  const { globalStats, priorityTasks, userStats } = useMemo(() => {
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
      userStats: ALL_USERNAMES.map(username => {
        const userTasks = allTasks[username] || [];
        const completed = userTasks.filter(t => t.completed).length;
        const total = userTasks.length;
        const progress = total > 0 ? (completed / total) * 100 : 0;
        return { username, completed, pending: total - completed, total, progress };
      }),
    };
    return stats;
  }, [allTasks]);

  const viewingUserTasks = useMemo(() => {
    const tasks = (allTasks[viewingUser] || []).slice().sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
    if (taskFilter === 'da_fare') return tasks.filter(t => !t.completed);
    if (taskFilter === 'completate') return tasks.filter(t => t.completed);
    return tasks;
  }, [allTasks, viewingUser, taskFilter]);

  // Group tasks by apartment if viewing Juan
  const { unassignedTasks, tasksByApartment } = useMemo(() => {
    if (viewingUser !== 'Juan') return { unassignedTasks: viewingUserTasks, tasksByApartment: {} as Record<string, Task[]> };

    const unassigned: Task[] = [];
    const grouped: Record<string, Task[]> = {};
    APARTMENTS.forEach(apt => grouped[apt] = []);

    viewingUserTasks.forEach(task => {
        if (task.apartment && APARTMENTS.includes(task.apartment)) {
            grouped[task.apartment].push(task);
        } else {
            unassigned.push(task);
        }
    });

    return { unassignedTasks: unassigned, tasksByApartment: grouped };
  }, [viewingUserTasks, viewingUser]);


  // Admin Photo Upload (needed because TaskItem expects it)
  const handlePhotoUpload = async (taskId: string, file: File) => {
    if (!file) return;
    setUploadingPhotoId(taskId);
    try {
        const storageRef = ref(storage, `tasks/${taskId}/${file.name}`);
        const downloadURL = await uploadBytes(storageRef, file).then(snapshot => getDownloadURL(snapshot.ref));
        await updateDoc(doc(db, "tasks", taskId), { photo: downloadURL });
    } finally {
        setUploadingPhotoId(null);
    }
  };

  const toggleApartment = (aptName: string) => {
    setExpandedApartments(prev => ({ ...prev, [aptName]: !prev[aptName] }));
  };

  const renderTask = (task: Task) => (
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
  );

  return (
    <section className="admin-dashboard">
      <div className="stats-grid">
        <div className="stat-widget"><h3>Attività da Fare</h3><p className="stat-value">{globalStats.totalPending}</p></div>
        <div className="stat-widget"><h3>Completate (7gg)</h3><p className="stat-value">{globalStats.completedLastWeek}</p></div>
      </div>
      <div className="widget-container">
        <div className="widget">
            <h3>Panoramica Utenti</h3>
            <div className="user-overview-grid">
              {userStats.map(({ username, completed, pending, progress }) => (
                <div key={username} className="user-card">
                  <h4>{username}</h4>
                  <p>In Sospeso: {pending} / Completate: {completed}</p>
                  <div className="progress-bar-container"><div className="progress-bar-fill" style={{ width: `${progress}%` }}></div></div>
                </div>
              ))}
            </div>
          </div>
        {priorityTasks.length > 0 && (
          <div className="widget">
            <h3>★ Priorità Assolute</h3>
            <ul className="priority-tasks-list">{priorityTasks.map(task => (<li key={task.id}><span>{task.text} ({task.owner})</span></li>))}</ul>
          </div>
        )}
      </div>
      <div className="task-management-section">
        <h2>Gestione Attività: {viewingUser}</h2>
        <div className="task-filters">
          <button className={taskFilter === 'da_fare' ? 'active' : ''} onClick={() => setTaskFilter('da_fare')}>Da Fare</button>
          <button className={taskFilter === 'completate' ? 'active' : ''} onClick={() => setTaskFilter('completate')}>Completate</button>
          <button className={taskFilter === 'tutte' ? 'active' : ''} onClick={() => setTaskFilter('tutte')}>Tutte</button>
        </div>
        
        {viewingUser === 'Juan' ? (
             <>
                 {/* Admin View of Juan's Apartments */}
                 <div className="apartments-container">
                    {APARTMENTS.map(apt => {
                        const aptTasks = tasksByApartment[apt] || [];
                        const isExpanded = expandedApartments[apt];
                        return (
                            <div key={apt} className="apartment-group">
                                <div className="apartment-header" onClick={() => toggleApartment(apt)}>
                                    <span>{apt} {aptTasks.length > 0 && <span className="apt-task-count">({aptTasks.length})</span>}</span>
                                    <span className={`apartment-arrow ${isExpanded ? 'expanded' : ''}`}>▼</span>
                                </div>
                                {isExpanded && (
                                    <ul className="task-list apartment-task-list">
                                        {aptTasks.length > 0 ? aptTasks.map(renderTask) : <li className="no-tasks-apt">Nessuna attività programmata qui.</li>}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                 </div>
                 
                 {/* Unassigned tasks for Juan */}
                 {unassignedTasks.length > 0 && (
                     <>
                        <h3 className="section-title">Attività Generali / Non Assegnate</h3>
                        <ul className="task-list">
                            {unassignedTasks.map(renderTask)}
                        </ul>
                     </>
                 )}
                 {unassignedTasks.length === 0 && Object.values(tasksByApartment).every((arr: any) => arr.length === 0) && (
                     <p className="no-tasks">Nessuna attività per i filtri selezionati.</p>
                 )}
             </>
        ) : (
            /* Standard View for other users */
            viewingUserTasks.length > 0 ? (
            <ul className="task-list">
                {viewingUserTasks.map(renderTask)}
            </ul>
            ) : (<p className="no-tasks">Nessuna attività per i filtri selezionati.</p>)
        )}

      </div>
    </section>
  );
};


// --- COMPONENTE PRINCIPAL APP ---
function App({ user, onLogout }: { user: any, onLogout: () => void }) {
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [displayDate, setDisplayDate] = useState(new Date());
  const [modalState, setModalState] = useState<ModalState>({ type: null });
  const [suggestions, setSuggestions] = useState<Suggestions>({ stagionali: [], contestuali: []});
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [viewingUser, setViewingUser] = useState<string>(user.role === 'admin' ? ALL_USERNAMES[0] : user.username);
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  
  // State for collapsible apartments
  const [expandedApartments, setExpandedApartments] = useState<Record<string, boolean>>({});

  const tasks = useMemo(() => allTasks[viewingUser] || [], [allTasks, viewingUser]);

  // 1. CARGA DE DATOS DESDE FIRESTORE
  useEffect(() => {
    let q;
    if (user.role === 'admin') {
      q = query(collection(db, "tasks"));
    } else {
      q = query(collection(db, "tasks"), where("owner", "==", user.username));
    }
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tasksByOwner: Record<string, Task[]> = {};
      snapshot.docs.forEach((doc) => {
        const taskData = doc.data();
        const task = { 
            id: doc.id, 
            ...taskData,
            subtasks: taskData.subtasks || [] 
        } as Task;
        if (!tasksByOwner[task.owner]) { tasksByOwner[task.owner] = []; }
        tasksByOwner[task.owner].push(task);
      });
      setAllTasks(tasksByOwner);
    });
    return () => unsubscribe();
  }, [user]);

  // 2. FUNCIONES DE DATOS CONECTADAS A FIREBASE
  const handleSaveTask = async (data: { text: string; dueDate?: string; apartment?: string }, taskToEdit?: Partial<Task>) => {
    if (taskToEdit?.id) {
      await updateDoc(doc(db, "tasks", taskToEdit.id), { 
          text: data.text, 
          dueDate: data.dueDate || null,
          apartment: data.apartment || null 
      });
    } else {
      await addDoc(collection(db, "tasks"), {
        text: data.text, date: toDateString(new Date()), completed: false, important: false, subtasks: [],
        dueDate: data.dueDate || null, owner: viewingUser, apartment: data.apartment || null, createdAt: serverTimestamp(),
      });
    }
    setModalState({ type: null });
  };
  const handleToggleTask = async (id: string) => {
    const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === id);
    if (task) await updateDoc(doc(db, "tasks", id), { completed: !task.completed, date: toDateString(new Date()) });
  };
  const handleToggleImportance = async (id: string) => {
    const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === id);
    if (task) await updateDoc(doc(db, "tasks", id), { important: !task.important });
  };
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === taskId);
    if (task) {
        const newSubtasks = task.subtasks.map(sub => sub.id === subtaskId ? { ...sub, completed: !sub.completed } : sub);
        const allSubtasksCompleted = newSubtasks.every(sub => sub.completed);
        await updateDoc(doc(db, "tasks", taskId), { subtasks: newSubtasks, completed: allSubtasksCompleted });
    }
  };
  const handleDeleteTask = async (id: string) => await deleteDoc(doc(db, "tasks", id));
  const handleUpdateNote = async (taskId: string, note: string) => await updateDoc(doc(db, "tasks", taskId), { note });
  const handlePhotoUpload = async (taskId: string, file: File) => {
    if (!file) return;
    setUploadingPhotoId(taskId);
    try {
        const storageRef = ref(storage, `tasks/${taskId}/${file.name}`);
        const downloadURL = await uploadBytes(storageRef, file).then(snapshot => getDownloadURL(snapshot.ref));
        await updateDoc(doc(db, "tasks", taskId), { photo: downloadURL });
    } finally {
        setUploadingPhotoId(null);
    }
  };
  const handleSubtaskPhotoUpload = async (taskId: string, subtaskId: string, file: File) => {
    const compositeId = `${taskId}-${subtaskId}`;
    setUploadingPhotoId(compositeId);
    try {
      const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === taskId);
      if (!task || !file) return;
      const storageRef = ref(storage, `subtasks/${compositeId}/${file.name}`);
      const downloadURL = await uploadBytes(storageRef, file).then(snapshot => getDownloadURL(snapshot.ref));
      const newSubtasks = task.subtasks.map(sub => sub.id === subtaskId ? { ...sub, photo: downloadURL } : sub);
      await updateDoc(doc(db, "tasks", taskId), { subtasks: newSubtasks });
    } finally {
      setUploadingPhotoId(null);
    }
  };
  const handleCreateChecklistTask = async (type: 'monthly' | 'quarterly', dueDate: string) => {
    const isMonthly = type === 'monthly';
    const checklist = isMonthly ? MONTHLY_CHECKLIST_ITEMS : QUARTERLY_CHECKLIST_ITEMS;
    const newSubtasks: SubTask[] = checklist.map((text, index) => ({ id: (Date.now() + index).toString(), text, completed: false }));
    await addDoc(collection(db, "tasks"), {
      text: isMonthly ? "Manutenzione Mensile" : "Manutenzione Trimestrale", date: toDateString(new Date()),
      completed: false, important: true, subtasks: newSubtasks, dueDate: dueDate || null, owner: viewingUser, createdAt: serverTimestamp(),
    });
    setModalState({ type: null });
  };
  const handleGetSuggestions = async () => {
        setIsSuggesting(true);
        setModalState({ type: 'suggestion' });
        setSuggestions({ stagionali: [], contestuali: [] });

        try {
            const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});
            const currentTasks = allTasks[viewingUser] || [];
            const taskListText = currentTasks.length > 0 ? currentTasks.map(t => `- ${t.text}`).join('\n') : 'Nessuna attività corrente.';
            const currentMonth = new Date().toLocaleString('it-IT', { month: 'long' });

            const prompt = `
                Sei un esperto di manutenzione di proprietà in Italia.
                Basandoti sulla lista di attività attuali e sul mese corrente, fornisci suggerimenti di manutenzione.
                Il mese corrente è ${currentMonth}.
                La lista delle attività attuali dell'utente (${viewingUser}) è:
                ${taskListText}

                Fornisci due tipi di suggerimenti:
                1.  **Suggerimenti Stagionali**: 3-4 compiti di manutenzione rilevanti per il mese di ${currentMonth} in Italia. Non suggerire attività già presenti nella lista utente.
                2.  **Suggerimenti Contestuali**: 2-3 compiti correlati o successivi a quelli già presenti nella lista. Se la lista è vuota, suggerisci attività di base per iniziare.

                Fornisci solo l'output JSON.`;

            const responseSchema = {
                type: Type.OBJECT,
                properties: {
                    stagionali: { type: Type.ARRAY, items: { type: Type.STRING } },
                    contestuali: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ["stagionali", "contestuali"]
            };
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: responseSchema },
            });

            const parsedSuggestions = JSON.parse(response.text);
            setSuggestions(parsedSuggestions);

        } catch (error) {
            console.error("Errore durante la generazione dei suggerimenti:", error);
            setSuggestions({ stagionali: ["Errore nel caricamento dei suggerimenti."], contestuali: [] });
        } finally {
            setIsSuggesting(false);
        }
    };
  const handleBreakdownTask = async (taskId: string) => {
        const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === taskId);
        if (!task || task.subtasks.length > 0) return;

        await updateDoc(doc(db, "tasks", taskId), { isBreakingDown: true });

        try {
            const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});
            const prompt = `Scomponi questa attività di manutenzione in una lista di 2-5 sotto-attività semplici e attuabili. Attività principale: "${task.text}"`;
            
            const responseSchema = {
                type: Type.OBJECT,
                properties: { subtasks: { type: Type.ARRAY, items: { type: Type.STRING } } },
                required: ["subtasks"]
            };
            
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema: responseSchema },
            });

            const result = JSON.parse(response.text);

            if (result.subtasks && result.subtasks.length > 0) {
                const newSubtasks: SubTask[] = result.subtasks.map((text: string, index: number) => ({
                    id: `${Date.now()}-${index}`, text: text, completed: false
                }));
                await updateDoc(doc(db, "tasks", taskId), { subtasks: newSubtasks });
            }
        } catch (error) {
            console.error("Errore durante la scomposizione dell'attività:", error);
        } finally {
            await updateDoc(doc(db, "tasks", taskId), { isBreakingDown: false });
        }
    };
  const handleAddSuggestion = (text: string) => { handleSaveTask({ text }); };

  // 3. LÓGICA DE LA INTERFAZ
  const handlePreviousDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() - 1)));
  const handleNextDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() + 1)));
  const handleSetToday = () => setDisplayDate(new Date());
  
  const toggleApartment = (aptName: string) => {
      setExpandedApartments(prev => ({ ...prev, [aptName]: !prev[aptName] }));
  };

  // 4. FILTERING AND GROUPING FOR CLIENT VIEW
  const { unassignedTasks, tasksByApartment } = useMemo(() => {
    if (user.role === 'admin') return { unassignedTasks: [], tasksByApartment: {} as Record<string, Task[]> };

    const dateStr = toDateString(displayDate);
    const dayTasks = (tasks || []).filter(task =>
        task.date === dateStr && task.text.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const unassigned: Task[] = [];
    const grouped: Record<string, Task[]> = {};

    // Initialize groups
    APARTMENTS.forEach(apt => grouped[apt] = []);

    dayTasks.forEach(task => {
        if (task.apartment && APARTMENTS.includes(task.apartment)) {
            grouped[task.apartment].push(task);
        } else {
            unassigned.push(task);
        }
    });

    return { unassignedTasks: unassigned, tasksByApartment: grouped };

  }, [tasks, searchTerm, displayDate, user.role]);

  return (
    <>
      {modalState.type === 'task' && <TaskModal user={user} viewingUser={viewingUser} taskToEdit={modalState.data || {}} onClose={() => setModalState({ type: null })} onSaveTask={handleSaveTask} onCreateChecklistTask={handleCreateChecklistTask} />}
      {modalState.type === 'suggestion' && <SuggestionsModal isOpen={true} isLoading={isSuggesting} suggestions={suggestions} onAdd={handleAddSuggestion} onClose={() => setModalState({ type: null })} />}
      {modalState.type === 'photo' && <PhotoPreviewModal imageUrl={modalState.data} onClose={() => setModalState({ type: null })} />}

      <header className="header">
        <h1>{user.role === 'admin' ? 'Admin Dashboard' : 'Le Mie Attività'}</h1>
        <div className="controls">
            <input
                type="text"
                className="search-bar"
                placeholder="Cerca attività..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
            {user.role === 'admin' && (
                <select className="user-selector" value={viewingUser} onChange={e => setViewingUser(e.target.value)}>
                    {ALL_USERNAMES.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
            )}
             <button className="suggest-btn" onClick={handleGetSuggestions} disabled={isSuggesting}>✨ Suggerimenti</button>
             <button className="add-btn" onClick={() => setModalState({ type: 'task' })} >
                {user.role === 'admin' ? '+ Assegna Attività' : '+ Aggiungi Attività'}
            </button>
            <button onClick={onLogout} className="logout-btn">Esci</button>
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
            handleUpdateNote={handleUpdateNote}
            handleSubtaskPhotoUpload={handleSubtaskPhotoUpload}
            setModalState={setModalState}
          />
      ) : (
        <>
            <section className="date-navigation">
                <button className="nav-btn" onClick={handlePreviousDay}>&lt;</button>
                <div className="date-display">
                    <h2 className="date-header">{getFormattedDate(displayDate)}</h2>
                    <button className="today-btn" onClick={handleSetToday}>Oggi</button>
                </div>
                <button className="nav-btn" onClick={handleNextDay}>&gt;</button>
            </section>

            {/* --- APARTMENT LISTS --- */}
            <div className="apartments-container">
                {APARTMENTS.map(apt => {
                    const aptTasks = tasksByApartment[apt] || [];
                    const isExpanded = expandedApartments[apt];
                    return (
                        <div key={apt} className="apartment-group">
                            <div className="apartment-header" onClick={() => toggleApartment(apt)}>
                                <span>{apt} {aptTasks.length > 0 && <span className="apt-task-count">({aptTasks.length})</span>}</span>
                                <span className={`apartment-arrow ${isExpanded ? 'expanded' : ''}`}>▼</span>
                            </div>
                            {isExpanded && (
                                <ul className="task-list apartment-task-list">
                                    {aptTasks.length > 0 ? (
                                        aptTasks.map(task => (
                                            <TaskItem 
                                                key={task.id}
                                                task={task}
                                                viewingUser={viewingUser}
                                                handleToggleTask={handleToggleTask}
                                                handleToggleImportance={handleToggleImportance}
                                                handleDeleteTask={handleDeleteTask}
                                                handlePhotoUpload={handlePhotoUpload}
                                                setModalState={setModalState}
                                                handleNoteSave={handleUpdateNote}
                                                uploadingPhotoId={uploadingPhotoId}
                                                // Features not needed for simple user view or optional
                                                handleBreakdownTask={handleBreakdownTask}
                                            />
                                        ))
                                    ) : (
                                        <li className="no-tasks-apt">Nessuna attività programmata qui.</li>
                                    )}
                                </ul>
                            )}
                        </div>
                    );
                })}
            </div>
            
            <hr className="divider-line" />

            {/* --- UNASSIGNED / GENERAL TASKS --- */}
            <h3 className="section-title">Attività Generali</h3>
            {unassignedTasks.length > 0 ? (
                <ul className="task-list">
                    {unassignedTasks.map(task => (
                        <TaskItem 
                            key={task.id}
                            task={task}
                            viewingUser={viewingUser}
                            handleToggleTask={handleToggleTask}
                            handleToggleImportance={handleToggleImportance}
                            handleDeleteTask={handleDeleteTask}
                            handleBreakdownTask={handleBreakdownTask} // Enable breakdown for general tasks
                            handlePhotoUpload={handlePhotoUpload}
                            setModalState={setModalState}
                            handleNoteSave={handleUpdateNote}
                            uploadingPhotoId={uploadingPhotoId}
                        />
                    ))}
                </ul>
            ) : (
                <p className="no-tasks">Nessuna attività generale per oggi.</p>
            )}
        </>
      )}
    </>
  );
}


// --- AUTH WRAPPER Y RENDER ---
const AuthWrapper = () => {
  const [user, setUser] = useState<any>(null);
  const [demoUser, setDemoUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          setUser({ uid: firebaseUser.uid, email: firebaseUser.email, ...userDoc.data() });

          // Request notification permission
          try {
              if (messaging && 'Notification' in window && Notification.permission === 'granted') {
                  const token = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY_HERE' });
                  if (token) {
                      await updateDoc(userDocRef, { fcmTokens: arrayUnion(token) });
                  }
              }
          } catch(err) {
              console.error('Error getting FCM token:', err);
          }
        } else {
            // Handle case where user exists in Auth but not in Firestore
            setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
      document.getElementById('root')?.classList.toggle('login-active', !firebaseUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    setDemoUser(null);
    try {
        if (user && user.uid && messaging) {
            const userDocRef = doc(db, 'users', user.uid);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                 const currentToken = await getToken(messaging, { vapidKey: 'YOUR_VAPID_KEY_HERE' }).catch(() => null);
                 if (currentToken) {
                    const existingTokens = userDocSnap.data().fcmTokens || [];
                    const updatedTokens = existingTokens.filter((t: string) => t !== currentToken);
                    await updateDoc(userDocRef, { fcmTokens: updatedTokens });
                 }
            }
        }
    } catch(err) {
        console.error("Could not remove FCM token on logout", err);
    }
    await signOut(auth);
  };
  
  const handleDemoLogin = () => {
      setDemoUser({
          uid: 'demo-admin-id',
          username: ALL_USERNAMES[0], // Use first user as default admin
          role: 'admin',
          email: 'demo@admin.com',
          fcmTokens: []
      });
      document.getElementById('root')?.classList.remove('login-active');
  };

  const handleDemoJuanLogin = () => {
      setDemoUser({
          uid: 'demo-juan-id',
          username: 'Juan',
          role: 'user', // Non-admin
          email: 'juan@demo.com',
          fcmTokens: []
      });
      document.getElementById('root')?.classList.remove('login-active');
  };

  if (loading) {
    return <div className="loading-screen">Caricamento in corso...</div>;
  }
  
  const activeUser = user || demoUser;

  return activeUser ? <App user={activeUser} onLogout={handleLogout} /> : <LoginPage onDemoLogin={handleDemoLogin} onDemoJuanLogin={handleDemoJuanLogin} />;
};

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<AuthWrapper />);
// --- FIN DEL CÓDIGO ---
