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
}

interface Suggestions {
  stagionali: string[];
  contestuali: string[];
}

// Fix for line 456: Define a specific discriminated union type for the modal state
// to ensure type safety when accessing modal data.
type ModalState =
    | { type: null }
    | { type: 'task'; data?: Partial<Task> }
    | { type: 'photo'; data: string }
    | { type: 'suggestion'; data?: never };

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


// --- COMPONENTE LOGIN (CORREGIDO Y SIMPLIFICADO) ---
const LoginPage = () => {
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
const TaskModal = ({ user, viewingUser, taskToEdit, onClose, onSaveTask, onCreateChecklistTask }: { user: any, viewingUser: string, taskToEdit: Partial<Task>, onClose: () => void, onSaveTask: (data: { text: string; dueDate?: string }, task?: Partial<Task>) => void, onCreateChecklistTask: (type: 'monthly' | 'quarterly', dueDate: string) => void }) => {
  const isEditing = 'id' in taskToEdit;
  const [text, setText] = useState(isEditing ? taskToEdit.text || '' : '');
  const [dueDate, setDueDate] = useState(isEditing ? taskToEdit.dueDate || '' : '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (text.trim()) {
      onSaveTask({ text: text.trim(), dueDate: dueDate || undefined }, isEditing ? taskToEdit : undefined);
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
        {user.role === 'admin' && viewingUser === 'Angelo' && !isEditing && (
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


// --- ADMIN DASHBOARD (CORREGIDO) ---
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
  // Fix for line 456: Use the strongly-typed ModalState for the setModalState prop.
  setModalState: (state: ModalState) => void,
}) => {
  const [taskFilter, setTaskFilter] = useState<'da_fare' | 'completate' | 'tutte'>('da_fare');
  const [expandedNoteTaskId, setExpandedNoteTaskId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');
  const photoUploadEnabledUsers = ['Angelo', 'Elias', 'Matteo', 'Juan'];

  const { globalStats, priorityTasks, userStats } = useMemo(() => {
    const allUsernames = ['Angelo', 'Matteo', 'Juan', 'Elias'];
    // FIX: Explicitly type `allUserTasks` to aid type inference, which may fail with .flat().
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
      userStats: allUsernames.map(username => {
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

  const handleNoteToggle = (task: Task) => {
    if (expandedNoteTaskId === task.id) { setExpandedNoteTaskId(null); } 
    else { setEditingNote(task.note || ''); setExpandedNoteTaskId(task.id); }
  };

  const handleNoteSave = (taskId: string) => {
      handleUpdateNote(taskId, editingNote);
      setExpandedNoteTaskId(null);
  };

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
        {viewingUserTasks.length > 0 ? (
          <ul className="task-list">
            {viewingUserTasks.map(task => {
                const urgencyClass = getUrgencyClass(task.dueDate, new Date());
                const isNoteExpanded = expandedNoteTaskId === task.id;
                return (
              <li key={task.id} className={`task-item ${task.completed ? 'completed' : ''} ${task.important ? 'important' : ''} ${task.isBreakingDown ? 'loading' : ''} ${urgencyClass}`}>
                 <button className={`importance-btn ${task.important ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleToggleImportance(task.id); }}>★</button>
                <div className="task-content-wrapper">
                    <div className="task-main" onClick={() => handleToggleTask(task.id)}>
                        <div className={`checkbox ${task.completed ? 'checked' : ''}`}>{task.completed && '✓'}</div>
                        <div className="task-text-container">
                            <span className="task-text">{task.text}</span>
                            {task.dueDate && (<span className={`task-due-date ${urgencyClass}`}>Scadenza: {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}</span>)}
                        </div>
                    </div>
                  {task.subtasks && task.subtasks.length > 0 && (
                    <ul className="subtask-list">
                      {task.subtasks.map(subtask => (
                        <li key={subtask.id} className={`subtask-item ${subtask.completed ? 'completed' : ''}`} >
                          <div className='subtask-content' onClick={() => handleToggleSubtask(task.id, subtask.id)}>
                            <div className={`checkbox ${subtask.completed ? 'checked' : ''}`}>{subtask.completed && '✓'}</div>
                            <span className="task-text">{subtask.text}</span>
                          </div>
                            {photoUploadEnabledUsers.includes(viewingUser) && subtask.photo && (<img src={subtask.photo} alt="Anteprima sotto-attività" className="task-photo-thumbnail subtask-photo-thumbnail" onClick={() => setModalState({ type: 'photo', data: subtask.photo! })} />)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isNoteExpanded && (
                      <div className="note-section">
                          <textarea className="note-textarea" value={editingNote} onChange={(e) => setEditingNote(e.target.value)} placeholder="Aggiungi una nota..." />
                          <button className="note-save-btn" onClick={() => handleNoteSave(task.id)}>Salva</button>
                      </div>
                  )}
                </div>
                <div className="task-actions">
                    {photoUploadEnabledUsers.includes(viewingUser) && task.photo && (<img src={task.photo} alt="Anteprima" className="task-photo-thumbnail" onClick={() => setModalState({ type: 'photo', data: task.photo! })} />)}
                    <button className={`action-btn note-toggle-btn ${isNoteExpanded ? 'expanded' : ''}`} onClick={() => handleNoteToggle(task)}>📝</button>
                    <button className="action-btn breakdown-btn" onClick={() => handleBreakdownTask(task.id)} disabled={task.isBreakingDown}>🪄</button>
                    <button className="action-btn edit-btn" onClick={() => setModalState({ type: 'task', data: task })}>✏️</button>
                    <button className="action-btn delete-btn" onClick={() => handleDeleteTask(task.id)}>&times;</button>
                </div>
              </li>
            )})}
          </ul>
        ) : (<p className="no-tasks">Nessuna attività per i filtri selezionati.</p>)}
      </div>
    </section>
  );
};


// --- COMPONENTE PRINCIPAL APP (CON LÓGICA DE UI ORIGINAL) ---
function App({ user, onLogout }: { user: any, onLogout: () => void }) {
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [displayDate, setDisplayDate] = useState(new Date());
  // Fix for line 456: Use the strongly-typed ModalState for the modal state.
  const [modalState, setModalState] = useState<ModalState>({ type: null });
  const [suggestions, setSuggestions] = useState<Suggestions>({ stagionali: [], contestuali: []});
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [viewingUser, setViewingUser] = useState<string>(user.role === 'admin' ? 'Juan' : user.username);
  const [expandedNoteTaskId, setExpandedNoteTaskId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');
  const [uploadingPhotoId, setUploadingPhotoId] = useState<string | null>(null);
  
  const tasks = useMemo(() => allTasks[viewingUser] || [], [allTasks, viewingUser]);
  const photoUploadEnabledUsers = ['Angelo', 'Elias', 'Matteo', 'Juan'];

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
  const handleSaveTask = async (data: { text: string; dueDate?: string }, taskToEdit?: Partial<Task>) => {
    if (taskToEdit?.id) {
      await updateDoc(doc(db, "tasks", taskToEdit.id), { text: data.text, dueDate: data.dueDate || null });
    } else {
      await addDoc(collection(db, "tasks"), {
        text: data.text, date: toDateString(new Date()), completed: false, important: false, subtasks: [],
        dueDate: data.dueDate || null, owner: viewingUser, createdAt: serverTimestamp(),
      });
    }
    setModalState({ type: null });
  };
  const handleToggleTask = async (id: string) => {
    // Fix for line 462: Explicitly cast the flattened array to Task[] to resolve type inference issues with the .flat() method.
    const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === id);
    if (task) await updateDoc(doc(db, "tasks", id), { completed: !task.completed, date: toDateString(new Date()) });
  };
  const handleToggleImportance = async (id: string) => {
    // Fix for line 468: Explicitly cast the flattened array to Task[] to resolve type inference issues with the .flat() method.
    const task: Task | undefined = (Object.values(allTasks).flat() as Task[]).find(t => t.id === id);
    if (task) await updateDoc(doc(db, "tasks", id), { important: !task.important });
  };
  const handleToggleSubtask = async (taskId: string, subtaskId: string) => {
    // FIX: Consistently cast the result of .flat() to Task[] to avoid type inference issues.
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
      // Fix for line 486: Explicitly cast the flattened array to Task[] to resolve type inference issues with the .flat() method.
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
        // Fix for line 554: Explicitly cast the flattened array to Task[] to resolve type inference issues with the .flat() method.
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
  const handleNoteToggle = (task: Task) => {
    if (expandedNoteTaskId === task.id) { setExpandedNoteTaskId(null); } 
    else { setEditingNote(task.note || ''); setExpandedNoteTaskId(task.id); }
  };
  const handleNoteSave = (taskId: string) => { handleUpdateNote(taskId, editingNote); setExpandedNoteTaskId(null); };

  // 3. LÓGICA DE LA INTERFAZ ORIGINAL (INTACTA)
  const handlePreviousDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() - 1)));
  const handleNextDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() + 1)));
  const goToToday = () => setDisplayDate(new Date());
  const displayedTasks = useMemo(() => {
    const currentDisplayDateStr = toDateString(displayDate);
    const visibleTasks = tasks.filter(task => {
        if (task.completed) return task.date === currentDisplayDateStr;
        const isCreated = task.date <= currentDisplayDateStr;
        const isNotExpired = !task.dueDate || currentDisplayDateStr <= task.dueDate;
        return isCreated && isNotExpired;
    });
    return visibleTasks.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
  }, [tasks, displayDate]);
  const filteredTasks = useMemo(() => displayedTasks.filter(task => task.text.toLowerCase().includes(searchTerm.toLowerCase())), [displayedTasks, searchTerm]);
  const isToday = toDateString(displayDate) === toDateString(new Date());
  const headerTitle = user.role === 'admin' ? "Admin Dashboard" : `Dashboard di ${user.username}`;
  
  return (
    <>
      {modalState.type === 'task' && <TaskModal user={user} viewingUser={viewingUser} taskToEdit={modalState.data || {}} onClose={() => setModalState({ type: null })} onSaveTask={handleSaveTask} onCreateChecklistTask={handleCreateChecklistTask} />}
      {modalState.type === 'photo' && <PhotoPreviewModal imageUrl={modalState.data} onClose={() => setModalState({ type: null })} />}
      {user.role === 'admin' && <SuggestionsModal isOpen={modalState.type === 'suggestion'} isLoading={isSuggesting} suggestions={suggestions} onAdd={handleAddSuggestion} onClose={() => setModalState({ type: null })} />}
      <div className="app-container">
        <header className="header">
            <h1>{headerTitle}</h1>
            <div className="controls">
                <input type="text" placeholder="Cerca attività..." className="search-bar" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                {user.role === 'admin' ? (
                <>
                    <select className="user-selector" value={viewingUser} onChange={(e) => setViewingUser(e.target.value)}>
                        {['Angelo', 'Matteo', 'Juan', 'Elias'].map(username => <option key={username} value={username}>{username}</option>)}
                    </select>
                    <button className="suggest-btn" onClick={handleGetSuggestions} disabled={isSuggesting}>{isSuggesting ? '...' : '✨ Suggerimenti'}</button>
                    <button className="add-btn" onClick={() => setModalState({ type: 'task' })}>+ Assegna Attività</button>
                </>
                ) : null}
                <button className="logout-btn" onClick={onLogout}>Esci</button>
            </div>
        </header>

        {user.role === 'admin' ? (
          <AdminDashboard allTasks={allTasks} viewingUser={viewingUser} handleToggleTask={handleToggleTask} handleToggleSubtask={handleToggleSubtask} handleToggleImportance={handleToggleImportance} handleDeleteTask={handleDeleteTask} handleBreakdownTask={handleBreakdownTask} handleUpdateNote={handleUpdateNote} handleSubtaskPhotoUpload={handleSubtaskPhotoUpload} setModalState={setModalState} />
        ) : (
          <section className="daily-log">
            <div className="date-navigation">
              <button onClick={handlePreviousDay} className="nav-btn" aria-label="Giorno precedente">&lt;</button>
              <div className="date-display">
                  <h2 className="date-header">{getFormattedDate(displayDate)}</h2>
                  {!isToday && <button className="today-btn" onClick={goToToday}>Oggi</button>}
              </div>
              <button onClick={handleNextDay} className="nav-btn" aria-label="Giorno successivo">&gt;</button>
            </div>
            
            {filteredTasks.length > 0 ? (
              <ul className="task-list">
                {filteredTasks.map(task => {
                    const urgencyClass = getUrgencyClass(task.dueDate, displayDate);
                    const isNoteExpanded = expandedNoteTaskId === task.id;
                    const isUploading = uploadingPhotoId === task.id;
                    return (
                  <li key={task.id} className={`task-item ${task.completed ? 'completed' : ''} ${task.important ? 'important' : ''} ${task.isBreakingDown ? 'loading' : ''} ${urgencyClass}`}>
                    {task.important && <span className="importance-indicator" aria-label="Attività Prioritaria">★</span>}
                    <div className="task-content-wrapper">
                      <div className="task-main" onClick={() => handleToggleTask(task.id)}>
                        <div className={`checkbox ${task.completed ? 'checked' : ''}`}>{task.completed && '✓'}</div>
                        <div className="task-text-container">
                           <span className="task-text">{task.text}</span>
                            {task.dueDate && (<span className={`task-due-date ${urgencyClass}`}>Scadenza: {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}</span>)}
                        </div>
                      </div>
                      {task.subtasks && task.subtasks.length > 0 && (
                        <ul className="subtask-list">
                          {task.subtasks.map(subtask => {
                            const isUploadingSubtask = uploadingPhotoId === `${task.id}-${subtask.id}`;
                            return (
                            <li key={subtask.id} className={`subtask-item ${subtask.completed ? 'completed' : ''}`}>
                                <div className='subtask-content' onClick={() => handleToggleSubtask(task.id, subtask.id)}>
                                    <div className={`checkbox ${subtask.completed ? 'checked' : ''}`}>{subtask.completed && '✓'}</div>
                                    <span className="task-text">{subtask.text}</span>
                                </div>
                                {photoUploadEnabledUsers.includes(user.username) && !subtask.completed && (
                                    <label className={`action-btn photo-upload-btn subtask-photo-btn ${subtask.photo && !isUploadingSubtask ? 'uploaded' : ''}`} aria-label={subtask.photo ? "Foto caricata" : "Carica foto per sotto-attività"}>
                                        {isUploadingSubtask ? <div className="photo-spinner"></div> : (subtask.photo ? '✅' : '📷')}
                                        <input type="file" accept="image/*" style={{ display: 'none' }} disabled={isUploadingSubtask} onChange={(e) => {
                                                if (e.target.files && e.target.files[0]) { handleSubtaskPhotoUpload(task.id, subtask.id, e.target.files[0]); }
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                )}
                            </li>
                          )})}
                        </ul>
                      )}
                        {isNoteExpanded && (
                            <div className="note-section">
                                <textarea className="note-textarea" value={editingNote} onChange={(e) => setEditingNote(e.target.value)} placeholder="Aggiungi una nota..."/>
                                <button className="note-save-btn" onClick={() => handleNoteSave(task.id)}>Salva</button>
                            </div>
                        )}
                    </div>
                    <div className="task-actions">
                      {task.completed ? (<div className="task-completed-feedback">😊 Grazie!</div>) : (
                        <>
                            {photoUploadEnabledUsers.includes(user.username) && (
                                <label className={`action-btn photo-upload-btn ${task.photo && !isUploading ? 'uploaded' : ''}`} aria-label={task.photo ? "Foto caricata" : "Carica foto di prova"}>
                                    {isUploading ? <div className="photo-spinner"></div> : (task.photo ? '✅' : '📷')}
                                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={isUploading} onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) { handlePhotoUpload(task.id, e.target.files[0]); }
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                            )}
                            <button className={`action-btn note-toggle-btn ${isNoteExpanded ? 'expanded' : ''}`} aria-label={isNoteExpanded ? 'Chiudi nota' : 'Apri nota'} onClick={() => handleNoteToggle(task)}>📝</button>
                            <button className="action-btn breakdown-btn" aria-label={`Scomponi task ${task.text}`} onClick={() => handleBreakdownTask(task.id)} disabled={task.isBreakingDown}>🪄</button>
                            <button className="action-btn edit-btn" aria-label={`Modifica task ${task.text}`} onClick={() => setModalState({ type: 'task', data: task })}>✏️</button>
                        </>
                      )}
                    </div>
                  </li>
                    )})}
              </ul>
            ) : (<p className="no-tasks">Nessuna attività per questa giornata.</p>)}
          </section>
        )}
      </div>
    </>
  );
}

// --- GESTOR DE SESIÓN DE FIREBASE ---
const AppWrapper = () => {
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const requestNotificationPermission = async (uid: string) => {
            if (!messaging) {
                console.log("Firebase Messaging is not supported or failed to initialize. Skipping notification permission request.");
                return;
            }
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    console.log('Notification permission granted.');
                    
                    // IMPORTANT: Get this from your Firebase project settings
                    // Go to Project Settings > Cloud Messaging > Web push certificates
                    // Then copy the "Key pair" and paste it below.
                    const vapidKey = 'BC10KhpAMyqWpqXurxG4t11zqyscTy5-t7UWpvoJS-IENyu0PzcirK1jkBpomlK22x0dXm6AF3W-JcTzjTxfEmQ'; 

                    const fcmToken = await getToken(messaging, { vapidKey: vapidKey });
                    
                    if (fcmToken) {
                        console.log('FCM Token:', fcmToken);
                        const tokenRef = doc(db, 'fcm_tokens', uid);
                        const tokenDoc = await getDoc(tokenRef);
                        if (tokenDoc.exists()) {
                            // Use arrayUnion to avoid duplicate tokens
                            await updateDoc(tokenRef, { tokens: arrayUnion(fcmToken) });
                        } else {
                            await setDoc(tokenRef, { tokens: [fcmToken] });
                        }
                    } else {
                        console.log('No registration token available. Request permission to generate one.');
                    }
                } else {
                    console.log('Unable to get permission to notify.');
                }
            } catch (error) {
                console.error('An error occurred while retrieving token. ', error);
            }
        };

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser && firebaseUser.email) {
                const usernameRaw = firebaseUser.email.split('@')[0];
                const username = usernameRaw.charAt(0).toUpperCase() + usernameRaw.slice(1);
                const role = username.toLowerCase() === 'admin' ? 'admin' : 'user';
                const userPayload = { username, role, email: firebaseUser.email, uid: firebaseUser.uid };

                // Save/update user profile in Firestore
                await setDoc(doc(db, "users", firebaseUser.uid), {
                    username: userPayload.username,
                    email: userPayload.email,
                    role: userPayload.role
                }, { merge: true });

                setCurrentUser(userPayload);
                await requestNotificationPermission(firebaseUser.uid);

            } else {
                setCurrentUser(null);
            }
            setIsLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const rootElement = document.getElementById('root');
        if (rootElement) {
            if (!currentUser && !isLoading) {
                rootElement.classList.add('login-active');
            } else {
                rootElement.classList.remove('login-active');
            }
        }
    }, [currentUser, isLoading]);

    const handleLogout = async () => {
        await signOut(auth);
    };
    
    if (isLoading) {
        return <div className="loading-screen">Caricamento in corso...</div>;
    }
    
    return currentUser ? <App user={currentUser} onLogout={handleLogout} /> : <LoginPage />;
};


// --- RENDERIZADO FINAL DE LA APP ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <AppWrapper />
        </React.StrictMode>
    );
}