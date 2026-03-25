import { User, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { MessageSquare, FileText, History as HistoryIcon, LogOut, Stethoscope, Users } from 'lucide-react';
import { cn } from '../lib/utils';

interface NavigationProps {
  activeTab: 'chat' | 'records' | 'history' | 'experts';
  setActiveTab: (tab: 'chat' | 'records' | 'history' | 'experts') => void;
  user: User;
}

export function Navigation({ activeTab, setActiveTab, user }: NavigationProps) {
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const navItems = [
    { id: 'chat', label: 'Symptom Checker', icon: MessageSquare },
    { id: 'records', label: 'Medical Records', icon: FileText },
    { id: 'history', label: 'Check History', icon: HistoryIcon },
    { id: 'experts', label: 'Experts', icon: Users },
  ] as const;

  return (
    <nav className="w-full md:w-72 bg-white border-r border-[#5A5A40]/10 flex flex-col h-screen sticky top-0">
      <div className="p-8 flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center shadow-sm shadow-[#5A5A40]/20">
          <Stethoscope className="w-6 h-6 text-white" />
        </div>
        <span className="text-2xl font-serif text-[#1a1a1a]">MedAssist</span>
      </div>

      <div className="flex-1 px-4 space-y-2">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={cn(
              "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all duration-200 text-left font-medium",
              activeTab === item.id
                ? "bg-[#5A5A40] text-white shadow-md shadow-[#5A5A40]/20"
                : "text-[#5A5A40] hover:bg-[#5A5A40]/5"
            )}
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="p-6 border-t border-[#5A5A40]/10">
        <div className="flex items-center gap-4 mb-6 px-2">
          {user.photoURL ? (
            <img src={user.photoURL} alt={user.displayName || ''} className="w-10 h-10 rounded-full border border-[#5A5A40]/10" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40] font-bold">
              {user.displayName?.[0] || 'U'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#1a1a1a] truncate">{user.displayName}</p>
            <p className="text-xs text-[#5A5A40]/60 truncate">{user.email}</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-[#5A5A40] hover:bg-red-50 hover:text-red-700 transition-all duration-200 font-medium"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
