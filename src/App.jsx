import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  serverTimestamp 
} from 'firebase/firestore';
import { auth, googleProvider, db, ADMIN_EMAIL } from './firebase/config';
import './App.css'; // Import del CSS

const TaskManagementApp = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // Authentication listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser({
          id: user.uid,
          email: user.email,
          name: user.displayName,
          photoURL: user.photoURL,
          isAdmin: user.email === ADMIN_EMAIL
        });
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Firestore listeners
  useEffect(() => {
    if (!currentUser) return;

    // Listen to tasks
    const tasksQuery = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        dueDate: doc.data().dueDate?.toDate?.()?.toISOString() || doc.data().dueDate,
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt
      }));
      setTasks(tasksData);
    });

    // Listen to users
    const usersQuery = query(collection(db, 'users'));
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsers(usersData);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeUsers();
    };
  }, [currentUser]);

  // Authentication functions
  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Add user to Firestore if not exists
      await addDoc(collection(db, 'users'), {
        id: user.uid,
        email: user.email,
        name: user.displayName,
        photoURL: user.photoURL,
        approved: user.email === ADMIN_EMAIL,
        createdAt: serverTimestamp()
      });

      // Send notification to admin if not admin
      if (user.email !== ADMIN_EMAIL) {
        await addDoc(collection(db, 'notifications'), {
          type: 'user_approval',
          message: `Nuovo utente richiede approvazione: ${user.email}`,
          targetUserId: 'admin',
          userId: user.uid,
          read: false,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('Error signing in:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Task functions
  const createTask = async (taskData) => {
    try {
      await addDoc(collection(db, 'tasks'), {
        title: taskData.title,
        description: taskData.description,
        assignedTo: taskData.assignedTo,
        dueDate: new Date(`${taskData.dueDate}T${taskData.dueTime}`),
        status: 'aperto',
        createdBy: currentUser.id,
        createdAt: serverTimestamp(),
        assignmentHistory: [taskData.assignedTo],
        comments: []
      });
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const updateTaskStatus = async (taskId, newStatus) => {
    try {
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const addComment = async (taskId, comment) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      const newComment = {
        id: Date.now().toString(),
        userId: currentUser.id,
        userName: currentUser.name,
        text: comment,
        timestamp: new Date().toISOString()
      };
      
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        comments: [...(task.comments || []), newComment],
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error adding comment:', error);
    }
  };

  const reassignTask = async (taskId, newAssignee) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      const taskRef = doc(db, 'tasks', taskId);
      await updateDoc(taskRef, {
        assignedTo: newAssignee,
        assignmentHistory: [...(task.assignmentHistory || []), newAssignee],
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error reassigning task:', error);
    }
  };

  // Utility functions
  const isOverdue = (dueDate) => new Date(dueDate) < new Date();
  
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('it-IT') + ' ' + date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusColor = (status) => {
    const colors = {
      'aperto': 'status-open',
      'in_lavorazione': 'status-progress',
      'in_revisione': 'status-review',
      'completato': 'status-completed',
      'chiuso': 'status-closed'
    };
    return colors[status] || colors['aperto'];
  };

  const getStatusText = (status) => {
    const texts = {
      'aperto': 'Aperto',
      'in_lavorazione': 'In Lavorazione',
      'in_revisione': 'In Revisione',
      'completato': 'Completato',
      'chiuso': 'Chiuso'
    };
    return texts[status] || 'Sconosciuto';
  };

  // Task filtering
  const getFilteredTasks = () => {
    let filtered = tasks;
    
    if (searchTerm) {
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (filterStatus !== 'all') {
      filtered = filtered.filter(task => task.status === filterStatus);
    }
    
    return filtered;
  };

  // Dashboard task categorization
  const getTasksByCategory = () => {
    const assignedToMe = tasks.filter(task => task.assignedTo === currentUser.id && task.status !== 'chiuso');
    const createdByMe = tasks.filter(task => task.createdBy === currentUser.id);
    const overdue = assignedToMe.filter(task => isOverdue(task.dueDate));
    
    return {
      assignedToMe: assignedToMe.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
      createdByMe: createdByMe.filter(task => task.status !== 'chiuso'),
      completedByMe: createdByMe.filter(task => task.status === 'chiuso'),
      overdue
    };
  };

  // Loading screen
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="logo">
            <div className="logo-icon">✓</div>
            <h1>TaskFlow</h1>
          </div>
          <div className="loading-spinner"></div>
          <p>Caricamento...</p>
        </div>
      </div>
    );
  }

  // Login screen
  if (!currentUser) {
    return (
      <div className="login-screen">
        <div className="login-container">
          <div className="login-content">
            <div className="logo">
              <div className="logo-icon">✓</div>
              <h1>TaskFlow</h1>
            </div>
            <p className="login-subtitle">Sistema di gestione task aziendali</p>
            
            <button onClick={handleGoogleSignIn} className="btn btn-primary login-btn">
              <span>🚀</span>
              Accedi con Google
            </button>
            
            <p className="login-note">
              L'accesso richiede approvazione dell'amministratore
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main App Components
  const Header = () => (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">✓</div>
            <h1>TaskFlow</h1>
          </div>
        </div>
        
        <div className="header-right">
          <div className="notification-bell">
            <span className="bell-icon">🔔</span>
            {notifications.filter(n => !n.read).length > 0 && (
              <div className="notification-badge">{notifications.filter(n => !n.read).length}</div>
            )}
          </div>
          
          <div className="user-profile">
            <img 
              src={currentUser.photoURL} 
              alt={currentUser.name}
              className="profile-image"
            />
            <span className="user-name">{currentUser.name}</span>
          </div>
          
          <button onClick={handleSignOut} className="btn btn-secondary logout-btn">
            Esci
          </button>
        </div>
      </div>
    </header>
  );

  const Navigation = () => (
    <nav className="app-navigation">
      <div className="nav-content">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: '📊' },
          { id: 'calendar', label: 'Calendario', icon: '📅' },
          { id: 'all-tasks', label: 'Tutti i Task', icon: '📋' },
          ...(currentUser.isAdmin ? [{ id: 'users', label: 'Utenti', icon: '👥' }] : [])
        ].map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setCurrentView(id)}
            className={`nav-tab ${currentView === id ? 'active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );

  const TaskCard = ({ task, showAssignee = false, compact = false }) => {
    const assignee = users.find(u => u.id === task.assignedTo);
    const overdueTask = isOverdue(task.dueDate);
    
    return (
      <div 
        className={`task-card ${overdueTask ? 'overdue' : ''} ${compact ? 'compact' : ''}`}
        onClick={() => setSelectedTask(task)}
      >
        <div className="task-header">
          <h3 className="task-title">{task.title}</h3>
          <span className={`status-badge ${getStatusColor(task.status)}`}>
            {getStatusText(task.status)}
          </span>
        </div>
        
        {!compact && (
          <p className="task-description">
            {task.description}
          </p>
        )}
        
        <div className="task-footer">
          <div className="task-meta">
            <div className={`due-date ${overdueTask ? 'overdue' : ''}`}>
              <span className="clock-icon">🕒</span>
              <span>{formatDate(task.dueDate)}</span>
              {overdueTask && <span className="overdue-icon">⚠️</span>}
            </div>
            
            {task.comments && task.comments.length > 0 && (
              <div className="comment-count">
                <span className="comment-icon">💬</span>
                <span>{task.comments.length}</span>
              </div>
            )}
          </div>
          
          {showAssignee && assignee && (
            <div className="assignee">
              <img src={assignee.photoURL} alt={assignee.name} className="assignee-avatar" />
              <span className="assignee-name">{assignee.name}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const DashboardView = () => {
    const { assignedToMe, createdByMe, overdue } = getTasksByCategory();
    
    return (
      <div className="dashboard">
        {/* Quick Actions */}
        <div className="section">
          <div className="section-header">
            <h2>Azioni Rapide</h2>
          </div>
          <button 
            onClick={() => setShowCreateTask(true)}
            className="btn btn-primary create-task-btn"
          >
            <span>➕</span>
            Crea Nuovo Task
          </button>
        </div>

        {/* Overdue Tasks */}
        {overdue.length > 0 && (
          <div className="section overdue-section">
            <div className="section-header">
              <h2>⚠️ Task Scaduti ({overdue.length})</h2>
            </div>
            <div className="task-list">
              {overdue.map(task => (
                <TaskCard key={task.id} task={task} compact />
              ))}
            </div>
          </div>
        )}

        {/* Assigned to Me */}
        <div className="section">
          <div className="section-header">
            <h2>Assegnati a Me ({assignedToMe.length})</h2>
          </div>
          {assignedToMe.length === 0 ? (
            <div className="empty-state">
              <p>Nessun task assegnato</p>
            </div>
          ) : (
            <div className="task-list">
              {assignedToMe.slice(0, 3).map(task => (
                <TaskCard key={task.id} task={task} />
              ))}
              {assignedToMe.length > 3 && (
                <button 
                  onClick={() => setCurrentView('all-tasks')}
                  className="btn btn-secondary view-all-btn"
                >
                  Vedi tutti ({assignedToMe.length})
                </button>
              )}
            </div>
          )}
        </div>

        {/* Created by Me */}
        <div className="section">
          <div className="section-header">
            <h2>Creati da Me ({createdByMe.length})</h2>
          </div>
          {createdByMe.length === 0 ? (
            <div className="empty-state">
              <p>Nessun task creato</p>
            </div>
          ) : (
            <div className="task-list">
              {createdByMe.slice(0, 2).map(task => (
                <TaskCard key={task.id} task={task} showAssignee />
              ))}
              {createdByMe.length > 2 && (
                <button className="btn btn-secondary view-all-btn">
                  Vedi tutti ({createdByMe.length})
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const CreateTaskModal = () => {
    const [formData, setFormData] = useState({
      title: '',
      description: '',
      assignedTo: '',
      dueDate: '',
      dueTime: ''
    });

    const handleSubmit = async () => {
      if (!formData.title || !formData.description || !formData.assignedTo || !formData.dueDate || !formData.dueTime) {
        alert('Compila tutti i campi');
        return;
      }
      
      await createTask(formData);
      setShowCreateTask(false);
      setFormData({ title: '', description: '', assignedTo: '', dueDate: '', dueTime: '' });
    };

    if (!showCreateTask) return null;

    return (
      <div className="modal-overlay">
        <div className="modal">
          <div className="modal-header">
            <h2>Crea Nuovo Task</h2>
            <button 
              onClick={() => setShowCreateTask(false)}
              className="modal-close"
            >
              ✕
            </button>
          </div>
          
          <div className="modal-content">
            <div className="form-group">
              <label>Titolo</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({...formData, title: e.target.value})}
                placeholder="Inserisci il titolo del task"
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label>Descrizione</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({...formData, description: e.target.value})}
                rows={3}
                placeholder="Descrivi il task in dettaglio"
                className="form-textarea"
              />
            </div>

            <div className="form-group">
              <label>Assegna a</label>
              <select
                value={formData.assignedTo}
                onChange={(e) => setFormData({...formData, assignedTo: e.target.value})}
                className="form-select"
              >
                <option value="">Seleziona utente</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Data</label>
                <input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                  className="form-input"
                />
              </div>
              
              <div className="form-group">
                <label>Ora</label>
                <input
                  type="time"
                  value={formData.dueTime}
                  onChange={(e) => setFormData({...formData, dueTime: e.target.value})}
                  className="form-input"
                />
              </div>
            </div>

            <div className="modal-actions">
              <button
                onClick={() => setShowCreateTask(false)}
                className="btn btn-secondary"
              >
                Annulla
              </button>
              <button
                onClick={handleSubmit}
                className="btn btn-primary"
              >
                Crea Task
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const TaskDetailModal = () => {
    const [newComment, setNewComment] = useState('');
    const [isReassigning, setIsReassigning] = useState(false);
    const [newAssignee, setNewAssignee] = useState('');

    if (!selectedTask) return null;

    const task = tasks.find(t => t.id === selectedTask.id) || selectedTask;
    const assignee = users.find(u => u.id === task.assignedTo);
    const creator = users.find(u => u.id === task.createdBy);
    const isAssignedToMe = task.assignedTo === currentUser.id;
    const isCreatedByMe = task.createdBy === currentUser.id;
    const overdueTask = isOverdue(task.dueDate);

    const handleStatusChange = async (newStatus) => {
      await updateTaskStatus(task.id, newStatus);
    };

    const handleAddComment = async () => {
      if (!newComment.trim()) return;
      await addComment(task.id, newComment.trim());
      setNewComment('');
    };

    const handleReassign = async () => {
      if (!newAssignee) return;
      await reassignTask(task.id, newAssignee);
      setIsReassigning(false);
      setNewAssignee('');
    };

    return (
      <div className="modal-overlay">
        <div className="modal task-detail-modal">
          <div className="modal-header">
            <button 
              onClick={() => setSelectedTask(null)}
              className="modal-close"
            >
              ✕
            </button>
            <div className="header-left">
              <h2>{task.title}</h2>
              <span className={`status-badge ${getStatusColor(task.status)}`}>
                {getStatusText(task.status)}
              </span>
            </div>
          </div>
          
          <div className="modal-content">
            {/* Task Info */}
            <div className="task-info">
              <div className="info-row">
                <span className="info-label">Descrizione:</span>
                <p className="info-value">{task.description}</p>
              </div>
              
              <div className="info-row">
                <span className="info-label">Scadenza:</span>
                <span className={`info-value ${overdueTask ? 'overdue-text' : ''}`}>
                  {formatDate(task.dueDate)}
                  {overdueTask && <span className="overdue-icon">⚠️</span>}
                </span>
              </div>

              <div className="info-row">
                <span className="info-label">Assegnato a:</span>
                <div className="assignee-info">
                  {assignee && (
                    <>
                      <img src={assignee.photoURL} alt={assignee.name} className="assignee-avatar" />
                      <span>{assignee.name}</span>
                    </>
                  )}
                  {(isCreatedByMe || isAssignedToMe) && (
                    <button 
                      onClick={() => setIsReassigning(true)}
                      className="btn btn-secondary btn-small"
                    >
                      Riassegna
                    </button>
                  )}
                </div>
              </div>

              <div className="info-row">
                <span className="info-label">Creato da:</span>
                <span className="info-value">{creator?.name || 'Sconosciuto'}</span>
              </div>
            </div>

            {/* Status Actions */}
            {isAssignedToMe && (
              <div className="status-actions">
                <h3>Azioni</h3>
                <div className="action-buttons">
                  {task.status === 'aperto' && (
                    <button 
                      onClick={() => handleStatusChange('in_lavorazione')}
                      className="btn btn-primary"
                    >
                      Inizia Lavorazione
                    </button>
                  )}
                  {task.status === 'in_lavorazione' && (
                    <button 
                      onClick={() => handleStatusChange('in_revisione')}
                      className="btn btn-primary"
                    >
                      Invia in Revisione
                    </button>
                  )}
                  {task.status === 'in_revisione' && isCreatedByMe && (
                    <div className="action-buttons">
                      <button 
                        onClick={() => handleStatusChange('completato')}
                        className="btn btn-primary"
                      >
                        Approva e Completa
                      </button>
                      <button 
                        onClick={() => handleStatusChange('in_lavorazione')}
                        className="btn btn-secondary"
                      >
                        Rimanda in Lavorazione
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Reassign Form */}
            {isReassigning && (
              <div className="reassign-form">
                <h3>Riassegna Task</h3>
                <div className="form-group">
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="form-select"
                  >
                    <option value="">Seleziona nuovo assegnatario</option>
                    {users.filter(u => u.id !== task.assignedTo).map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div className="action-buttons">
                  <button 
                    onClick={handleReassign}
                    className="btn btn-primary"
                    disabled={!newAssignee}
                  >
                    Riassegna
                  </button>
                  <button 
                    onClick={() => setIsReassigning(false)}
                    className="btn btn-secondary"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            {/* Comments */}
            <div className="comments-section">
              <h3>Commenti ({task.comments?.length || 0})</h3>
              
              <div className="comments-list">
                {task.comments?.map(comment => (
                  <div key={comment.id} className="comment">
                    <div className="comment-header">
                      <span className="comment-author">{comment.userName}</span>
                      <span className="comment-time">{formatDate(comment.timestamp)}</span>
                    </div>
                    <p className="comment-text">{comment.text}</p>
                  </div>
                ))}
              </div>

              <div className="add-comment">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Aggiungi un commento..."
                  className="form-textarea"
                  rows={3}
                />
                <button 
                  onClick={handleAddComment}
                  className="btn btn-primary"
                  disabled={!newComment.trim()}
                >
                  Aggiungi Commento
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const AllTasksView = () => (
    <div className="all-tasks">
      <div className="section">
        <div className="section-header">
          <h2>Tutti i Task</h2>
        </div>
        
        <div className="search-filters">
          <div className="search-box">
            <input
              type="text"
              placeholder="Cerca task..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
            />
          </div>
          
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="form-select"
          >
            <option value="all">Tutti</option>
            <option value="aperto">Aperti</option>
            <option value="in_lavorazione">In Lavorazione</option>
            <option value="in_revisione">In Revisione</option>
            <option value="completato">Completati</option>
          </select>
        </div>

        <div className="task-list">
          {getFilteredTasks().map(task => (
            <TaskCard key={task.id} task={task} showAssignee />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      <Header />
      <Navigation />
      
      <main className="app-main">
        <div className="main-content">
          {currentView === 'dashboard' && <DashboardView />}
          {currentView === 'all-tasks' && <AllTasksView />}
          {currentView === 'calendar' && (
            <div className="section">
              <h2>Vista Calendario</h2>
              <div className="empty-state">
                <p>Vista calendario in sviluppo...</p>
              </div>
            </div>
          )}
          {currentView === 'users' && currentUser.isAdmin && (
            <div className="section">
              <h2>Gestione Utenti</h2>
              <div className="empty-state">
                <p>Gestione utenti in sviluppo...</p>
              </div>
            </div>
          )}
        </div>
      </main>

      <CreateTaskModal />
      <TaskDetailModal />
      
      {/* Floating Action Button */}
      <button 
        onClick={() => setShowCreateTask(true)}
        className="fab"
      >
        ➕
      </button>
    </div>
  );
};

export default TaskManagementApp;