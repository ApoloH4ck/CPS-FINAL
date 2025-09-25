import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- DATI UTENTI PREDEFINITI ---
const USERS = {
  admin: { password: '#@dm¡n2*25#', role: 'admin' },
  Juan: { password: 'juan2021', role: 'user' },
  Matteo: { password: 'matteo2022', role: 'user' },
  Angelo: { password: 'angelo2023', role: 'user' },
  Elias: { password: 'elias2024', role: 'user' },
};

type User = {
  username: string;
  role: 'admin' | 'user';
}

// --- TYPE DEFINITION ---
interface SubTask {
  id: number;
  text: string;
  completed: boolean;
  photo?: string; // Base64 string for subtask image
}

interface Task {
  id: number;
  text: string;
  date: string; // Format: 'YYYY-MM-DD'
  completed: boolean;
  important: boolean;
  subtasks: SubTask[];
  isBreakingDown?: boolean;
  dueDate?: string; // Data di scadenza opzionale
  photo?: string; // Base64 string for the image
  note?: string; // Note opzionali per ogni attività
}

interface Suggestions {
  stagionali: string[];
  contestuali: string[];
}

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
const toDateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

const getFormattedDate = (date: Date): string => {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('it-IT', options);
};

const getUrgencyClass = (dueDate: string | undefined, currentDate: Date): string => {
    if (!dueDate) return '';

    const today = new Date(currentDate);
    today.setHours(0, 0, 0, 0);
    const due = new Date(dueDate + 'T00:00:00');
    
    const diffTime = due.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'urgency-high'; // Scaduta
    if (diffDays <= 1) return 'urgency-high'; // Oggi o domani
    if (diffDays <= 3) return 'urgency-medium'; // Entro 3 giorni
    return 'urgency-low'; // Piu di 3 giorni
};


// --- LOGIN PAGE COMPONENT ---
const LoginPage = ({ onLogin }: { onLogin: (user: User, remember: boolean) => void }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const usernameInputRef = React.useRef<HTMLInputElement>(null);

    useEffect(() => {
        usernameInputRef.current?.focus();
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const userRecord = USERS[username as keyof typeof USERS];
        if (userRecord && userRecord.password === password) {
            onLogin({ username, role: userRecord.role as 'admin' | 'user' }, rememberMe);
        } else {
            setError('Credenziali non valide. Riprova.');
        }
    };

    return (
        <div className="login-container">
            <div className="login-form">
                <h2>Accesso</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        ref={usernameInputRef}
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Nome Utente"
                        className="login-input"
                    />
                    <div className="password-input-container">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Password"
                            className="login-input"
                        />
                        <button
                            type="button"
                            className="show-password-btn"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? "Nascondi password" : "Mostra password"}
                        >
                            {showPassword ? '🙈' : '👁️'}
                        </button>
                    </div>
                     <div className="remember-me-container">
                        <input
                            type="checkbox"
                            id="remember-me"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                        />
                        <label htmlFor="remember-me">Ricordami</label>
                    </div>
                    {error && <p className="error-message">{error}</p>}
                    <button type="submit" className="login-button">Accedi</button>
                </form>
            </div>
        </div>
    );
};


// --- MODAL COMPONENT ---
const TaskModal = ({ user, viewingUser, taskToEdit, onClose, onSaveTask, onCreateChecklistTask }: { user: User, viewingUser: string, taskToEdit: Partial<Task>, onClose: () => void, onSaveTask: (data: { text: string; dueDate?: string }, task?: Task) => void, onCreateChecklistTask: (type: 'monthly' | 'quarterly', dueDate: string) => void }) => {
  const isEditing = 'id' in taskToEdit;
  const [text, setText] = useState(isEditing ? taskToEdit.text || '' : '');
  const [dueDate, setDueDate] = useState(isEditing ? taskToEdit.dueDate || '' : '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    if (text.trim()) {
      onSaveTask({ text: text.trim(), dueDate: dueDate || undefined }, isEditing ? taskToEdit as Task : undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>{isEditing ? 'Modifica Attività' : 'Nuova Attività'}</h3>
        <input
          ref={inputRef}
          type="text"
          className="modal-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Cosa c'è da fare?"
        />
        {user.role === 'admin' && (
          <div className="form-group">
            <label htmlFor="due-date">Data di Scadenza</label>
            <input
              id="due-date"
              type="date"
              className="modal-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={toDateString(new Date())}
            />
          </div>
        )}
        {user.role === 'admin' && viewingUser === 'Juan' && !isEditing && (
            <div className="checklist-actions">
                <p>O imposta una scadenza e crea una checklist di manutenzione:</p>
                <button
                    className="checklist-btn monthly"
                    onClick={() => onCreateChecklistTask('monthly', dueDate)}
                    disabled={!dueDate}
                    title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}
                >
                    Crea Manutenzione Mensile
                </button>
                <button
                    className="checklist-btn quarterly"
                    onClick={() => onCreateChecklistTask('quarterly', dueDate)}
                    disabled={!dueDate}
                    title={!dueDate ? "Seleziona una data di scadenza prima di creare una checklist" : ""}
                >
                    Crea Manutenzione Trimestrale
                </button>
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
        {isLoading ? (
          <p className="loading-suggestions">Ricerca di suggerimenti in corso...</p>
        ) : (
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


// --- ADMIN DASHBOARD COMPONENT ---
const AdminDashboard = ({ 
  allTasks, 
  viewingUser,
  handleToggleTask,
  handleToggleSubtask,
  handleToggleImportance,
  handleDeleteTask,
  handleBreakdownTask,
  handleUpdateNote,
  handleSubtaskPhotoUpload,
  setModalState,
}: {
  allTasks: Record<string, Task[]>,
  viewingUser: string,
  handleToggleTask: (id: number) => void,
  handleToggleSubtask: (taskId: number, subtaskId: number) => void,
  handleToggleImportance: (id: number) => void,
  handleDeleteTask: (id: number) => void,
  handleBreakdownTask: (taskId: number) => void,
  handleUpdateNote: (taskId: number, note: string) => void,
  handleSubtaskPhotoUpload: (taskId: number, subtaskId: number, file: File) => void,
  setModalState: (state: { type: 'task' | 'suggestion' | 'photo' | null; data?: any }) => void,
}) => {
  const [taskFilter, setTaskFilter] = useState<'da_fare' | 'completate' | 'tutte'>('da_fare');
  const [expandedNoteTaskId, setExpandedNoteTaskId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState('');
  const photoUploadEnabledUsers = ['Juan', 'Elias', 'Matteo', 'Angelo'];

  const { globalStats, priorityTasks, userStats } = useMemo(() => {
    const allUserTasks = Object.entries(allTasks)
      .filter(([username]) => USERS[username as keyof typeof USERS]?.role === 'user')
      .flatMap(([, tasks]) => tasks);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = toDateString(sevenDaysAgo);

    const stats = {
      globalStats: {
        totalPending: allUserTasks.filter(t => !t.completed).length,
        completedLastWeek: allUserTasks.filter(t => t.completed && t.date >= sevenDaysAgoStr).length,
      },
      priorityTasks: allUserTasks.filter(t => t.important && !t.completed),
      userStats: Object.keys(USERS)
        .filter(username => USERS[username as keyof typeof USERS].role === 'user')
        .map(username => {
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
    if (expandedNoteTaskId === task.id) {
        setExpandedNoteTaskId(null);
    } else {
        setEditingNote(task.note || '');
        setExpandedNoteTaskId(task.id);
    }
  };

  const handleNoteSave = (taskId: number) => {
      handleUpdateNote(taskId, editingNote);
      setExpandedNoteTaskId(null);
  };

  return (
    <section className="admin-dashboard">
      <div className="stats-grid">
        <div className="stat-widget">
          <h3>Attività da Fare</h3>
          <p className="stat-value">{globalStats.totalPending}</p>
        </div>
        <div className="stat-widget">
          <h3>Completate (7gg)</h3>
          <p className="stat-value">{globalStats.completedLastWeek}</p>
        </div>
      </div>

      <div className="widget-container">
         <div className="widget">
            <h3>Panoramica Utenti</h3>
            <div className="user-overview-grid">
              {userStats.map(({ username, completed, pending, progress }) => (
                <div key={username} className="user-card">
                  <h4>{username}</h4>
                  <p>In Sospeso: {pending} / Completate: {completed}</p>
                  <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        
        {priorityTasks.length > 0 && (
          <div className="widget">
            <h3>★ Priorità Assolute</h3>
            <ul className="priority-tasks-list">
              {priorityTasks.map(task => (
                <li key={task.id}><span>{task.text}</span></li>
              ))}
            </ul>
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
                 <button 
                    className={`importance-btn ${task.important ? 'active' : ''}`} 
                    aria-label={task.important ? 'Rimuovi priorità' : 'Aggiungi priorità'}
                    onClick={(e) => { e.stopPropagation(); handleToggleImportance(task.id); }}
                  >★</button>
                <div className="task-content-wrapper">
                    <div className="task-main" onClick={() => handleToggleTask(task.id)}>
                        <div className={`checkbox ${task.completed ? 'checked' : ''}`}>{task.completed && '✓'}</div>
                        <div className="task-text-container">
                            <span className="task-text">{task.text}</span>
                            {task.dueDate && (
                                <span className="task-due-date">
                                    Scadenza: {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </span>
                            )}
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
                           {photoUploadEnabledUsers.includes(viewingUser) && subtask.photo && (
                                <img 
                                    src={subtask.photo} 
                                    alt="Anteprima sotto-attività" 
                                    className="task-photo-thumbnail subtask-photo-thumbnail" 
                                    onClick={() => setModalState({ type: 'photo', data: subtask.photo })} 
                                />
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isNoteExpanded && (
                      <div className="note-section">
                          <textarea 
                              className="note-textarea"
                              value={editingNote}
                              onChange={(e) => setEditingNote(e.target.value)}
                              placeholder="Aggiungi una nota..."
                          />
                          <button className="note-save-btn" onClick={() => handleNoteSave(task.id)}>Salva</button>
                      </div>
                  )}
                </div>
                <div className="task-actions">
                    {photoUploadEnabledUsers.includes(viewingUser) && task.photo && (
                        <img 
                            src={task.photo} 
                            alt="Anteprima" 
                            className="task-photo-thumbnail" 
                            onClick={() => setModalState({ type: 'photo', data: task.photo })} 
                        />
                    )}
                    <button 
                        className={`action-btn note-toggle-btn ${isNoteExpanded ? 'expanded' : ''}`} 
                        aria-label={isNoteExpanded ? 'Chiudi nota' : 'Apri nota'} 
                        onClick={() => handleNoteToggle(task)}>
                        ▼
                    </button>
                    <button className="action-btn breakdown-btn" aria-label={`Scomponi task ${task.text}`} onClick={() => handleBreakdownTask(task.id)} disabled={task.isBreakingDown}>🪄</button>
                    <button className="action-btn edit-btn" aria-label={`Modifica task ${task.text}`} onClick={() => setModalState({ type: 'task', data: task })}>✏️</button>
                    <button className="action-btn delete-btn" aria-label={`Elimina task ${task.text}`} onClick={() => handleDeleteTask(task.id)}>&times;</button>
                </div>
              </li>
            )})}
          </ul>
        ) : (
            <p className="no-tasks">Nessuna attività per i filtri selezionati.</p>
        )}
      </div>
    </section>
  );
};


// --- MAIN APP COMPONENT ---
function App({ user, onLogout }: { user: User, onLogout: () => void }) {
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({});
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [displayDate, setDisplayDate] = useState(new Date());
  
  const [modalState, setModalState] = useState<{ type: 'task' | 'suggestion' | 'photo' | null; data?: any }>({ type: null });
  const [suggestions, setSuggestions] = useState<Suggestions>({ stagionali: [], contestuali: []});
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [viewingUser, setViewingUser] = useState<string>(user.role === 'admin' ? 'Juan' : user.username);

  const [expandedNoteTaskId, setExpandedNoteTaskId] = useState<number | null>(null);
  const [editingNote, setEditingNote] = useState('');
  
  const tasks = useMemo(() => allTasks[viewingUser] || [], [allTasks, viewingUser]);
  const photoUploadEnabledUsers = ['Juan', 'Elias', 'Matteo', 'Angelo'];

  // Load tasks on initial render
  useEffect(() => {
    let loadedTasks: Record<string, Task[]> = {};
    try {
      const storedTasks = localStorage.getItem('userTasks');
      loadedTasks = storedTasks ? JSON.parse(storedTasks) : {};
      // Ensure subtasks is always an array for all tasks of all users
      Object.values(loadedTasks).flat().forEach(t => { if (!t.subtasks) t.subtasks = []; });
    } catch (error) {
      console.error("Failed to parse tasks from localStorage", error);
    }
    setAllTasks(loadedTasks);
  }, []);

  // Save tasks to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('userTasks', JSON.stringify(allTasks));
  }, [allTasks]);
  
  const updateTasksForUser = (userToUpdate: string, updatedTasks: Task[]) => {
      setAllTasks(prev => ({
          ...prev,
          [userToUpdate]: updatedTasks
      }));
  };

  const handleSaveTask = (data: { text: string; dueDate?: string }, taskToEdit?: Task) => {
    if (taskToEdit) {
      // Editing existing task
      const updated = tasks.map(t => t.id === taskToEdit.id ? { ...t, text: data.text, dueDate: data.dueDate } : t);
      updateTasksForUser(viewingUser, updated);
    } else {
      // Adding new task
      const newTaskDate = user.role === 'admin' ? toDateString(new Date()) : toDateString(displayDate);
      const newTask: Task = {
        id: Date.now(),
        text: data.text,
        date: newTaskDate,
        completed: false,
        important: false,
        subtasks: [],
        dueDate: data.dueDate,
      };
      updateTasksForUser(viewingUser, [...tasks, newTask]);
    }
    setModalState({ type: null });
  };
  
  const handleToggleTask = (id: number) => {
    const updated = tasks.map(task => {
      if (task.id === id) {
        const newCompletedStatus = !task.completed;
        // If completing, set completion date to today. If un-completing, can revert or just toggle status.
        return { ...task, completed: newCompletedStatus, date: newCompletedStatus ? toDateString(displayDate) : task.date };
      }
      return task;
    });
    updateTasksForUser(viewingUser, updated);
  };

  const handleToggleSubtask = (taskId: number, subtaskId: number) => {
      const updated = tasks.map(task => {
        if (task.id === taskId) {
          const newSubtasks = task.subtasks.map(sub => 
            sub.id === subtaskId ? { ...sub, completed: !sub.completed } : sub
          );
          const allSubtasksCompleted = newSubtasks.every(sub => sub.completed);
          return { ...task, subtasks: newSubtasks, completed: allSubtasksCompleted };
        }
        return task;
      });
      updateTasksForUser(viewingUser, updated);
  };

  const handleToggleImportance = (id: number) => {
      const updated = tasks.map(task =>
          task.id === id ? { ...task, important: !task.important } : task
      );
      updateTasksForUser(viewingUser, updated);
  };

  const handleDeleteTask = (id: number) => {
    const updated = tasks.filter(task => task.id !== id);
    updateTasksForUser(viewingUser, updated);
  };

  const handlePhotoUpload = (taskId: number, file: File) => {
    if (!file || !file.type.startsWith('image/')) {
        console.error("Please select an image file.");
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
        const photoData = event.target?.result as string;
        const updated = tasks.map(t => t.id === taskId ? { ...t, photo: photoData } : t);
        updateTasksForUser(viewingUser, updated);
    };
    reader.readAsDataURL(file);
  };

  const handleSubtaskPhotoUpload = (taskId: number, subtaskId: number, file: File) => {
    if (!file || !file.type.startsWith('image/')) {
        console.error("Please select an image file.");
        return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
        const photoData = event.target?.result as string;
        const updated = tasks.map(task => {
            if (task.id === taskId) {
                const newSubtasks = task.subtasks.map(sub => 
                    sub.id === subtaskId ? { ...sub, photo: photoData } : sub
                );
                return { ...task, subtasks: newSubtasks };
            }
            return task;
        });
        updateTasksForUser(viewingUser, updated);
    };
    reader.readAsDataURL(file);
  };


  const handleCreateChecklistTask = (type: 'monthly' | 'quarterly', dueDate: string) => {
      const isMonthly = type === 'monthly';
      const checklist = isMonthly ? MONTHLY_CHECKLIST_ITEMS : QUARTERLY_CHECKLIST_ITEMS;
      
      const newSubtasks: SubTask[] = checklist.map((text, index) => ({
          id: Date.now() + index,
          text,
          completed: false,
      }));

      const newTask: Task = {
          id: Date.now(),
          text: isMonthly ? "Manutenzione Mensile" : "Manutenzione Trimestrale",
          date: toDateString(new Date()),
          completed: false,
          important: true,
          subtasks: newSubtasks,
          dueDate: dueDate || undefined,
      };

      updateTasksForUser(viewingUser, [...tasks, newTask]);
      setModalState({ type: null });
  };
  
  const handleGetSuggestions = async () => {
    setSuggestions({ stagionali: [], contestuali: [] });
    setIsSuggesting(true);
    setModalState({ type: 'suggestion' });
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      const monthName = displayDate.toLocaleDateString('it-IT', { month: 'long' });
      
      const contextTasks = tasks.filter(t => !t.completed).slice(-5).map(t => `- ${t.text}`).join('\n');
      const prompt = `Sei un esperto di manutenzione domestica per l'Italia.
      
      Il mese attuale è ${monthName}.
      
      Ecco alcune attività recenti dell'utente:
      ${contextTasks.length > 0 ? contextTasks : "Nessuna attività recente."}

      Basandoti su questi dati, fornisci due tipi di suggerimenti:
      1.  **Suggerimenti contestuali**: 2-3 azioni successive o correlate alle attività recenti. Se non ci sono attività recenti o non ti vengono in mente suggerimenti pertinenti, restituisci un array vuoto.
      2.  **Suggerimenti stagionali**: 3 attività di manutenzione generiche e importanti per il mese di ${monthName} in Italia.

      Le risposte devono essere concise per una to-do list. Restituisci un oggetto JSON.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
                contestuali: { type: Type.ARRAY, items: { type: Type.STRING } },
                stagionali: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      });

      const suggestionsObject = JSON.parse(response.text);
      setSuggestions(suggestionsObject);

    } catch (error) {
        console.error("Error fetching AI suggestions:", error);
        setSuggestions({ stagionali: ["Errore nel caricamento."], contestuali: [] });
    } finally {
        setIsSuggesting(false);
    }
  };

  const handleBreakdownTask = async (taskId: number) => {
    const originalTasks = [...tasks];
    const tempTasks = originalTasks.map(t => t.id === taskId ? { ...t, isBreakingDown: true } : t);
    updateTasksForUser(viewingUser, tempTasks);

    try {
        const taskToBreakdown = tasks.find(t => t.id === taskId);
        if (!taskToBreakdown) return;

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        const prompt = `Suddividi la seguente attività di manutenzione in 3-5 sotto-attività semplici e attuabili. Restituisci solo un oggetto JSON con una chiave "subtasks" contenente un array di stringhe.
        
        Attività: "${taskToBreakdown.text}"`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        subtasks: { type: Type.ARRAY, items: { type: Type.STRING } }
                    }
                }
            }
        });

        const result = JSON.parse(response.text);
        const newSubtasks: SubTask[] = result.subtasks.map((text: string) => ({
            id: Date.now() + Math.random(),
            text,
            completed: false,
        }));
        
        const finalTasks = originalTasks.map(t => t.id === taskId ? { ...t, subtasks: newSubtasks, completed: false, isBreakingDown: false } : t);
        updateTasksForUser(viewingUser, finalTasks);

    } catch (error) {
        console.error("Error breaking down task:", error);
        const finalTasks = originalTasks.map(t => t.id === taskId ? { ...t, isBreakingDown: false } : t);
        updateTasksForUser(viewingUser, finalTasks);
    }
  };

  const handleUpdateNote = (taskId: number, note: string) => {
      const updated = tasks.map(task =>
          task.id === taskId ? { ...task, note } : task
      );
      updateTasksForUser(viewingUser, updated);
  };
  
  const handleNoteToggle = (task: Task) => {
    if (expandedNoteTaskId === task.id) {
        setExpandedNoteTaskId(null);
    } else {
        setEditingNote(task.note || '');
        setExpandedNoteTaskId(task.id);
    }
  };

  const handleNoteSave = (taskId: number) => {
      handleUpdateNote(taskId, editingNote);
      setExpandedNoteTaskId(null);
  };

  const handleAddSuggestion = (text: string) => {
      const newTask: Task = {
        id: Date.now(),
        text: text,
        date: toDateString(displayDate),
        completed: false,
        important: false,
        subtasks: []
      };
      updateTasksForUser(viewingUser, [...tasks, newTask]);
  };

  const handlePreviousDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() - 1)));
  const handleNextDay = () => setDisplayDate(d => new Date(d.setDate(d.getDate() + 1)));
  const goToToday = () => setDisplayDate(new Date());

  const displayedTasks = useMemo(() => {
    const currentDisplayDateStr = toDateString(displayDate);

    const visibleTasks = tasks.filter(task => {
        // Mostra le attività completate solo nel giorno in cui sono state completate
        if (task.completed) {
            return task.date === currentDisplayDateStr;
        }

        // Per le attività non completate:
        const isCreated = task.date <= currentDisplayDateStr;
        const isNotExpired = !task.dueDate || currentDisplayDateStr <= task.dueDate;
        
        return isCreated && isNotExpired;
    });

    return visibleTasks.sort((a, b) => (b.important ? 1 : 0) - (a.important ? 1 : 0));
}, [tasks, displayDate]);


  const filteredTasks = useMemo(() => {
    return displayedTasks.filter(task =>
      task.text.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [displayedTasks, searchTerm]);
  
  const isToday = toDateString(displayDate) === toDateString(new Date());
  
  const headerTitle = user.role === 'admin' 
    ? "Admin Roma Deluxe Apartments"
    : `Dashboard di ${user.username}`;


  return (
    <>
      {modalState.type === 'task' && <TaskModal user={user} viewingUser={viewingUser} taskToEdit={modalState.data || {}} onClose={() => setModalState({ type: null })} onSaveTask={handleSaveTask} onCreateChecklistTask={handleCreateChecklistTask} />}
      {modalState.type === 'photo' && <PhotoPreviewModal imageUrl={modalState.data} onClose={() => setModalState({ type: null })} />}
      {user.role === 'admin' && (
        <SuggestionsModal 
          isOpen={modalState.type === 'suggestion'} 
          isLoading={isSuggesting}
          suggestions={suggestions}
          onAdd={handleAddSuggestion}
          onClose={() => setModalState({ type: null })}
        />
      )}
      <div className="app-container">
        <header className="header">
          <h1>{headerTitle}</h1>
          <div className="controls">
              <input type="text" placeholder="Cerca attività..." className="search-bar" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              {user.role === 'admin' ? (
                <>
                  <select className="user-selector" value={viewingUser} onChange={(e) => setViewingUser(e.target.value)}>
                      {Object.keys(USERS).filter(u => u !== 'admin').map(username => <option key={username} value={username}>{username}</option>)}
                  </select>
                   <button className="suggest-btn" onClick={handleGetSuggestions} disabled={isSuggesting}>
                    {isSuggesting ? '...' : '✨ Suggerimenti AI'}
                  </button>
                  <button className="add-btn" onClick={() => setModalState({ type: 'task' })}>+ Assegna Attività</button>
                </>
              ) : null}
               <button className="logout-btn" onClick={onLogout}>Esci</button>
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
                    return (
                  <li key={task.id} className={`task-item ${task.completed ? 'completed' : ''} ${task.important ? 'important' : ''} ${task.isBreakingDown ? 'loading' : ''} ${urgencyClass}`}>
                    {task.important && <span className="importance-indicator" aria-label="Attività Prioritaria">★</span>}
                    <div className="task-content-wrapper">
                      <div className="task-main" onClick={() => handleToggleTask(task.id)}>
                        <div className={`checkbox ${task.completed ? 'checked' : ''}`}>{task.completed && '✓'}</div>
                        <div className="task-text-container">
                           <span className="task-text">{task.text}</span>
                            {task.dueDate && (
                                <span className="task-due-date">
                                    Scadenza: {new Date(task.dueDate + 'T00:00:00').toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' })}
                                </span>
                            )}
                        </div>
                      </div>
                      {task.subtasks && task.subtasks.length > 0 && (
                        <ul className="subtask-list">
                          {task.subtasks.map(subtask => (
                            <li key={subtask.id} className={`subtask-item ${subtask.completed ? 'completed' : ''}`}>
                                <div className='subtask-content' onClick={() => handleToggleSubtask(task.id, subtask.id)}>
                                    <div className={`checkbox ${subtask.completed ? 'checked' : ''}`}>{subtask.completed && '✓'}</div>
                                    <span className="task-text">{subtask.text}</span>
                                </div>
                                {photoUploadEnabledUsers.includes(user.username) && !subtask.completed && (
                                    <label className={`action-btn photo-upload-btn subtask-photo-btn ${subtask.photo ? 'uploaded' : ''}`} aria-label={subtask.photo ? "Foto caricata" : "Carica foto per sotto-attività"}>
                                        {subtask.photo ? '✅' : '📷'}
                                        <input 
                                            type="file" 
                                            accept="image/*" 
                                            style={{ display: 'none' }} 
                                            onChange={(e) => {
                                                if (e.target.files && e.target.files[0]) {
                                                    handleSubtaskPhotoUpload(task.id, subtask.id, e.target.files[0]);
                                                }
                                                e.target.value = '';
                                            }}
                                        />
                                    </label>
                                )}
                            </li>
                          ))}
                        </ul>
                      )}
                       {isNoteExpanded && (
                            <div className="note-section">
                                <textarea 
                                    className="note-textarea"
                                    value={editingNote}
                                    onChange={(e) => setEditingNote(e.target.value)}
                                    placeholder="Aggiungi una nota..."
                                />
                                <button className="note-save-btn" onClick={() => handleNoteSave(task.id)}>Salva</button>
                            </div>
                        )}
                    </div>
                    <div className="task-actions">
                      {task.completed ? (
                          <div className="task-completed-feedback">😊 Grazie!</div>
                      ) : (
                        <>
                           {photoUploadEnabledUsers.includes(user.username) && (
                                <label className={`action-btn photo-upload-btn ${task.photo ? 'uploaded' : ''}`} aria-label={task.photo ? "Foto caricata" : "Carica foto di prova"}>
                                    {task.photo ? '✅' : '📷'}
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        style={{ display: 'none' }} 
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                handlePhotoUpload(task.id, e.target.files[0]);
                                            }
                                            e.target.value = ''; // Permette di ricaricare lo stesso file
                                        }}
                                    />
                                </label>
                            )}
                          <button 
                              className={`action-btn note-toggle-btn ${isNoteExpanded ? 'expanded' : ''}`} 
                              aria-label={isNoteExpanded ? 'Chiudi nota' : 'Apri nota'} 
                              onClick={() => handleNoteToggle(task)}>
                              ▼
                          </button>
                          <button className="action-btn breakdown-btn" aria-label={`Scomponi task ${task.text}`} onClick={() => handleBreakdownTask(task.id)} disabled={task.isBreakingDown}>🪄</button>
                          <button className="action-btn edit-btn" aria-label={`Modifica task ${task.text}`} onClick={() => setModalState({ type: 'task', data: task })}>✏️</button>
                        </>
                      )}
                    </div>
                  </li>
                    )})}
              </ul>
            ) : (
                <p className="no-tasks">Nessuna attività per questa giornata.</p>
            )}
          </section>
        )}
      </div>
    </>
  );
}

// --- APP MANAGER (Handles Authentication) ---
function AppManager() {
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    useEffect(() => {
        let user: User | null = null;
        try {
            const rememberedUser = localStorage.getItem('rememberedUser');
            if (rememberedUser) {
                user = JSON.parse(rememberedUser);
            } else {
                const loggedInUser = sessionStorage.getItem('currentUser');
                if (loggedInUser) {
                    user = JSON.parse(loggedInUser);
                }
            }
        } catch (error) {
            console.error("Failed to parse user from storage", error);
        }
        if (user) {
            setCurrentUser(user);
        }
    }, []);

    const handleLogin = (user: User, remember: boolean) => {
        if (remember) {
            localStorage.setItem('rememberedUser', JSON.stringify(user));
            sessionStorage.removeItem('currentUser');
        } else {
            sessionStorage.setItem('currentUser', JSON.stringify(user));
            localStorage.removeItem('rememberedUser');
        }
        setCurrentUser(user);
    };

    const handleLogout = () => {
        sessionStorage.removeItem('currentUser');
        localStorage.removeItem('rememberedUser');
        setCurrentUser(null);
    };

    if (!currentUser) {
        return <LoginPage onLogin={handleLogin} />;
    }

    return <App user={currentUser} onLogout={handleLogout} />;
}


// --- RENDER THE APP ---
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<React.StrictMode><AppManager /></React.StrictMode>);
}