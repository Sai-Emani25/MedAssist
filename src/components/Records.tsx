import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { Plus, FileText, Trash2, Loader2, AlertCircle, Calendar, X, Sparkles, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { analyzeMedicalRecord, chatAboutRecord, GeminiError, GeminiErrorType } from '../services/gemini';
import Markdown from 'react-markdown';
import { cn } from '../lib/utils';

interface RecordsProps {
  user: User;
}

interface MedicalRecord {
  id: string;
  recordType: 'blood_test' | 'diagnosis' | 'other';
  content?: string;
  analysis?: string;
  originalDiagnosis?: string;
  medication?: string;
  timestamp: string;
  fileData?: string;
  fileName?: string;
}

export function Records({ user }: RecordsProps) {
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newRecord, setNewRecord] = useState({
    recordType: 'blood_test' as const,
    content: '',
    originalDiagnosis: '',
    medication: '',
    fileData: '',
    fileName: ''
  });
  const [saving, setSaving] = useState(false);
  const [activeChatRecord, setActiveChatRecord] = useState<MedicalRecord | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', content: string, timestamp: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  const fetchRecords = async () => {
    const path = `users/${user.uid}/medicalRecords`;
    try {
      const q = query(collection(db, path), orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);
      setRecords(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MedicalRecord)));
    } catch (err) {
      console.error("Error fetching records:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [user.uid]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > 1024 * 1024) {
      alert("File size too large. Please upload files smaller than 1MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setNewRecord({
        ...newRecord,
        fileData: base64Data,
        fileName: selectedFile.name
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!newRecord.content.trim() && !newRecord.fileData) {
      alert("Please provide either a summary or a file attachment.");
      return;
    }

    setSaving(true);
    const path = `users/${user.uid}/medicalRecords`;
    try {
      // Generate AI analysis
      let analysis = '';
      try {
        analysis = await analyzeMedicalRecord(
          newRecord.recordType,
          newRecord.content,
          newRecord.originalDiagnosis,
          newRecord.medication,
          newRecord.fileData ? { data: newRecord.fileData, mimeType: 'application/octet-stream' } : undefined
        );
      } catch (aiErr: any) {
        console.warn("AI Analysis failed, saving record without it:", aiErr);
        // We still want to save the record even if analysis fails, 
        // but maybe we should notify the user or just save with a note.
        analysis = "AI analysis was unavailable for this record.";
      }

      await addDoc(collection(db, path), {
        ...newRecord,
        analysis,
        uid: user.uid,
        timestamp: new Date().toISOString()
      });
      setShowAdd(false);
      setNewRecord({ recordType: 'blood_test', content: '', originalDiagnosis: '', medication: '', fileData: '', fileName: '' });
      fetchRecords();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const path = `users/${user.uid}/medicalRecords/${id}`;
    try {
      await deleteDoc(doc(db, `users/${user.uid}/medicalRecords`, id));
      setRecords(records.filter(r => r.id !== id));
      if (activeChatRecord?.id === id) setActiveChatRecord(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const handleOpenChat = (record: MedicalRecord) => {
    setActiveChatRecord(record);
    setChatMessages([
      {
        role: 'model',
        content: `I've loaded this ${record.recordType.replace('_', ' ')} record. How can I help you understand it better?`,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeChatRecord || chatLoading) return;

    const userMsg = { role: 'user' as const, content: chatInput, timestamp: new Date().toISOString() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const response = await chatAboutRecord(activeChatRecord, [...chatMessages, userMsg]);
      setChatMessages(prev => [...prev, {
        role: 'model',
        content: response,
        timestamp: new Date().toISOString()
      }]);
    } catch (err: any) {
      console.error("Chat failed:", err);
      setChatMessages(prev => [...prev, {
        role: 'model',
        content: "I'm sorry, I encountered an error while analyzing this record. Please try again.",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
        <div className="text-center md:text-left">
          <h2 className="text-4xl font-serif text-[#1a1a1a] mb-4">Medical Records</h2>
          <p className="text-[#5A5A40]/60 italic font-serif">
            Securely store your test results and doctor's diagnoses.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white px-8 py-4 rounded-full flex items-center justify-center gap-3 shadow-md transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Add Record
        </button>
      </header>

      {showAdd && (
        <div className="bg-white rounded-[32px] p-8 shadow-sm border border-[#5A5A40]/10 animate-in fade-in slide-in-from-top-4 duration-300">
          <form onSubmit={handleAdd} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#5A5A40] uppercase tracking-wider">Record Type</label>
                <select
                  value={newRecord.recordType}
                  onChange={(e) => setNewRecord({ ...newRecord, recordType: e.target.value as any })}
                  className="w-full p-4 rounded-2xl bg-[#f5f5f0]/50 border border-[#5A5A40]/10 outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                >
                  <option value="blood_test">Blood Test Result</option>
                  <option value="diagnosis">Doctor's Diagnosis</option>
                  <option value="other">Other Medical Document</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-[#5A5A40] uppercase tracking-wider">Original Diagnosis (Optional)</label>
                <input
                  type="text"
                  value={newRecord.originalDiagnosis}
                  onChange={(e) => setNewRecord({ ...newRecord, originalDiagnosis: e.target.value })}
                  placeholder="e.g., Hypertension"
                  className="w-full p-4 rounded-2xl bg-[#f5f5f0]/50 border border-[#5A5A40]/10 outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#5A5A40] uppercase tracking-wider">Prescribed Medication (Optional)</label>
              <input
                type="text"
                value={newRecord.medication}
                onChange={(e) => setNewRecord({ ...newRecord, medication: e.target.value })}
                placeholder="e.g., Lisinopril 10mg"
                className="w-full p-4 rounded-2xl bg-[#f5f5f0]/50 border border-[#5A5A40]/10 outline-none focus:ring-2 focus:ring-[#5A5A40]/20"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#5A5A40] uppercase tracking-wider">Record Content / Summary (Optional)</label>
              <textarea
                value={newRecord.content}
                onChange={(e) => setNewRecord({ ...newRecord, content: e.target.value })}
                placeholder="Paste the results or summarize the doctor's notes here..."
                className="w-full h-40 p-6 rounded-2xl bg-[#f5f5f0]/50 border border-[#5A5A40]/10 outline-none focus:ring-2 focus:ring-[#5A5A40]/20 resize-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-[#5A5A40] uppercase tracking-wider">Attachment (Optional)</label>
              <div className="flex items-center gap-4">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,application/pdf"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl border border-[#5A5A40]/10 hover:bg-[#5A5A40]/5 transition-all text-[#5A5A40]"
                >
                  <Plus className="w-4 h-4" />
                  {newRecord.fileName ? 'Change File' : 'Upload File'}
                </button>
                {newRecord.fileName && (
                  <div className="flex items-center gap-2 bg-[#5A5A40]/5 px-4 py-2 rounded-xl text-sm text-[#5A5A40]">
                    <FileText className="w-4 h-4" />
                    {newRecord.fileName}
                    <button onClick={() => setNewRecord({ ...newRecord, fileName: '', fileData: '' })} className="hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-4">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-8 py-4 rounded-full text-[#5A5A40] hover:bg-[#5A5A40]/5 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white px-12 py-4 rounded-full shadow-md transition-all flex items-center gap-3"
              >
                {saving && <Loader2 className="w-5 h-5 animate-spin" />}
                Save Record
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-[#5A5A40]" />
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-[32px] p-20 text-center border border-[#5A5A40]/10">
          <FileText className="w-16 h-16 text-[#5A5A40]/20 mx-auto mb-6" />
          <h3 className="text-2xl font-serif text-[#1a1a1a] mb-2">No records yet</h3>
          <p className="text-[#5A5A40]/60 italic font-serif">Upload your first medical record to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {records.map((record) => (
            <div key={record.id} className="bg-white rounded-[32px] p-8 shadow-sm border border-[#5A5A40]/10 group hover:shadow-md transition-all">
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-[#5A5A40]/5 rounded-xl flex items-center justify-center text-[#5A5A40]">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-serif text-[#1a1a1a] capitalize">
                      {record.recordType.replace('_', ' ')}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-[#5A5A40]/60 font-serif italic">
                      <Calendar className="w-3 h-3" />
                      {format(new Date(record.timestamp), 'PPP')}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(record.id)}
                  className="p-3 text-[#5A5A40]/40 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                {(record.originalDiagnosis || record.medication) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-[#f5f5f0]/50 rounded-2xl border border-[#5A5A40]/5">
                    {record.originalDiagnosis && (
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-bold block mb-1">Diagnosis</span>
                        <p className="text-[#1a1a1a] font-serif">{record.originalDiagnosis}</p>
                      </div>
                    )}
                    {record.medication && (
                      <div>
                        <span className="text-[10px] uppercase tracking-widest text-[#5A5A40]/60 font-bold block mb-1">Medication</span>
                        <p className="text-[#1a1a1a] font-serif">{record.medication}</p>
                      </div>
                    )}
                  </div>
                )}
                
                {record.content && (
                  <div className="text-[#5A5A40] font-serif leading-relaxed whitespace-pre-wrap">
                    {record.content}
                  </div>
                )}

                {record.analysis && (
                  <div className="p-6 bg-[#5A5A40]/5 rounded-2xl border border-[#5A5A40]/10 space-y-3">
                    <div className="flex items-center gap-2 text-[#5A5A40]">
                      <Sparkles className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">AI Analysis</span>
                    </div>
                    <div className="prose prose-stone prose-sm max-w-none font-serif text-[#1a1a1a]">
                      <Markdown>{record.analysis}</Markdown>
                    </div>
                    <div className="pt-4 flex justify-end">
                      <button
                        onClick={() => handleOpenChat(record)}
                        className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#5A5A40] hover:underline"
                      >
                        <MessageSquare className="w-4 h-4" />
                        Chat about this record
                      </button>
                    </div>
                  </div>
                )}

                {record.fileName && (
                  <div className="pt-4 border-t border-[#5A5A40]/5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-[#5A5A40]/60 font-serif italic">
                      <FileText className="w-4 h-4" />
                      <span>Attached: {record.fileName}</span>
                    </div>
                    {record.fileData && (
                      <button
                        onClick={() => {
                          const win = window.open();
                          if (win) {
                            const isImage = record.fileName?.match(/\.(jpg|jpeg|png|gif)$/i);
                            if (isImage) {
                              win.document.write(`<img src="data:image/png;base64,${record.fileData}" style="max-width: 100%; height: auto;" />`);
                            } else {
                              win.document.write(`<iframe src="data:application/pdf;base64,${record.fileData}" style="width: 100%; height: 100vh; border: none;"></iframe>`);
                            }
                          }
                        }}
                        className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] hover:underline"
                      >
                        View Attachment
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeChatRecord && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-2xl h-full shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
            <header className="p-6 border-b border-[#5A5A40]/10 flex items-center justify-between bg-[#f5f5f0]/30">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#5A5A40]/10 rounded-xl flex items-center justify-center text-[#5A5A40]">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif text-lg text-[#1a1a1a]">Record Analysis Chat</h3>
                  <p className="text-xs text-[#5A5A40]/60 italic font-serif">
                    Discussing: {activeChatRecord.recordType.replace('_', ' ')} ({format(new Date(activeChatRecord.timestamp), 'MMM d, yyyy')})
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setActiveChatRecord(null)}
                className="p-2 hover:bg-[#5A5A40]/5 rounded-full transition-all"
              >
                <X className="w-6 h-6 text-[#5A5A40]" />
              </button>
            </header>

            <div 
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
            >
              {chatMessages.map((msg, i) => (
                <div 
                  key={i}
                  className={cn(
                    "flex flex-col max-w-[85%] animate-in fade-in slide-in-from-bottom-2 duration-300",
                    msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div 
                    className={cn(
                      "p-4 rounded-2xl font-serif text-base leading-relaxed",
                      msg.role === 'user' 
                        ? "bg-[#5A5A40] text-white rounded-tr-none" 
                        : "bg-[#f5f5f0] text-[#1a1a1a] rounded-tl-none border border-[#5A5A40]/5"
                    )}
                  >
                    <Markdown>{msg.content}</Markdown>
                  </div>
                  <span className="text-[10px] text-[#5A5A40]/40 mt-1 uppercase tracking-widest">
                    {format(new Date(msg.timestamp), 'h:mm a')}
                  </span>
                </div>
              ))}
              {chatLoading && (
                <div className="flex items-center gap-3 text-[#5A5A40]/60 italic font-serif animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Analyzing...</span>
                </div>
              )}
            </div>

            <form onSubmit={handleChatSubmit} className="p-6 border-t border-[#5A5A40]/10 bg-[#f5f5f0]/10">
              <div className="flex items-end gap-3 bg-white p-2 rounded-2xl border border-[#5A5A40]/10 shadow-sm">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask a question about this record..."
                  className="flex-1 p-3 rounded-xl bg-transparent border-none focus:ring-0 outline-none resize-none text-[#1a1a1a] placeholder-[#5A5A40]/40 font-serif text-base min-h-[44px] max-h-[150px]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSubmit(e as any);
                    }
                  }}
                  disabled={chatLoading}
                />
                <button
                  type="submit"
                  disabled={chatLoading || !chatInput.trim()}
                  className="bg-[#5A5A40] hover:bg-[#4A4A30] text-white p-3 rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
