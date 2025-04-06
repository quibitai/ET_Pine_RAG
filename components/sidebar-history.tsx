'use client';

import { isToday, isYesterday, subMonths, subWeeks } from 'date-fns';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { User } from 'next-auth';
import { memo, useEffect, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import {
  CheckCircleFillIcon,
  GlobeIcon,
  LockIcon,
  MoreHorizontalIcon,
  ShareIcon,
  TrashIcon,
} from '@/components/icons';
import { ChevronRight, ChevronDown } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Chat } from '@/lib/db/schema';
import { fetcher } from '@/lib/utils';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { Checkbox } from './ui/checkbox';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

// Custom TrashIcon wrapper that accepts both size and className
const StyledTrashIcon = ({ 
  size = 16, 
  className 
}: { 
  size?: number, 
  className?: string 
}) => (
  <svg
    height={size}
    width={size}
    viewBox="0 0 16 16"
    className={cn("text-current", className)}
    style={{ color: 'currentcolor' }}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M6.75 2.75C6.75 2.05964 7.30964 1.5 8 1.5C8.69036 1.5 9.25 2.05964 9.25 2.75V3H6.75V2.75ZM5.25 3V2.75C5.25 1.23122 6.48122 0 8 0C9.51878 0 10.75 1.23122 10.75 2.75V3H12.9201H14.25H15V4.5H14.25H13.8846L13.1776 13.6917C13.0774 14.9942 11.9913 16 10.6849 16H5.31508C4.00874 16 2.92263 14.9942 2.82244 13.6917L2.11538 4.5H1.75H1V3H1.75H3.07988H5.25ZM4.31802 13.5767L3.61982 4.5H12.3802L11.682 13.5767C11.6419 14.0977 11.2075 14.5 10.6849 14.5H5.31508C4.79254 14.5 4.3581 14.0977 4.31802 13.5767Z"
      fill="currentColor"
    />
  </svg>
);

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
  isSelected,
  onSelect,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
  isSelected: boolean;
  onSelect: (chatId: string, selected: boolean) => void;
}) => {
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat.id,
    initialVisibility: chat.visibility,
  });

  return (
    <SidebarMenuItem>
      <div className="flex items-center gap-2 w-full">
        <Checkbox 
          checked={isSelected}
          onCheckedChange={(checked) => onSelect(chat.id, !!checked)} 
          className="ml-1"
        />
        <SidebarMenuButton asChild isActive={isActive} className="flex-grow">
          <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)}>
            <span>{chat.title}</span>
          </Link>
        </SidebarMenuButton>
      </div>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground mr-0.5"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="cursor-pointer">
              <ShareIcon />
              <span>Share</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="cursor-pointer flex-row justify-between"
                  onClick={() => {
                    setVisibilityType('private');
                  }}
                >
                  <div className="flex flex-row gap-2 items-center">
                    <LockIcon size={12} />
                    <span>Private</span>
                  </div>
                  {visibilityType === 'private' ? (
                    <CheckCircleFillIcon />
                  ) : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer flex-row justify-between"
                  onClick={() => {
                    setVisibilityType('public');
                  }}
                >
                  <div className="flex flex-row gap-2 items-center">
                    <GlobeIcon />
                    <span>Public</span>
                  </div>
                  {visibilityType === 'public' ? <CheckCircleFillIcon /> : null}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuItem
            className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
            onSelect={() => onDelete(chat.id)}
          >
            <StyledTrashIcon size={16} />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
};

const ChatItem = memo(
  PureChatItem,
  (prevProps, nextProps) => prevProps.isActive === nextProps.isActive && prevProps.isSelected === nextProps.isSelected,
);

export function SidebarHistory({ user }: { user: User | undefined }) {
  const { setOpenMobile } = useSidebar();
  const { id } = useParams();
  const pathname = usePathname();
  const {
    data: history,
    isLoading,
    mutate,
  } = useSWR<Array<Chat>>(user ? '/api/history' : null, fetcher, {
    fallbackData: [],
  });

  // State for collapsed sections
  const [collapsedSections, setCollapsedSections] = useState<{
    yesterday: boolean;
    lastWeek: boolean;
    lastMonth: boolean;
    older: boolean;
  }>({
    yesterday: true,
    lastWeek: true,
    lastMonth: true,
    older: true,
  });

  // State for multi-select
  const [selectedChats, setSelectedChats] = useState<string[]>([]);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);

  // Toggle section collapse
  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections({
      ...collapsedSections,
      [section]: !collapsedSections[section],
    });
  };

  // Handle chat selection
  const handleSelectChat = (chatId: string, selected: boolean) => {
    if (selected) {
      setSelectedChats(prev => [...prev, chatId]);
      if (!isMultiSelectMode) setIsMultiSelectMode(true);
    } else {
      setSelectedChats(prev => prev.filter(id => id !== chatId));
      if (selectedChats.length === 1) setIsMultiSelectMode(false);
    }
  };

  // Toggle multi-select mode
  const toggleMultiSelectMode = () => {
    if (isMultiSelectMode) {
      setSelectedChats([]);
    }
    setIsMultiSelectMode(!isMultiSelectMode);
  };

  // Delete multiple chats
  const handleDeleteMultiple = async () => {
    if (selectedChats.length === 0) return;
    
    setShowDeleteDialog(true);
    setDeleteId('multiple');
  };

  useEffect(() => {
    mutate();
  }, [pathname, mutate]);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const router = useRouter();
  const handleDelete = async () => {
    // If deleting multiple chats
    if (deleteId === 'multiple') {
      // Create a promise for each deletion
      const deletePromises = selectedChats.map(chatId => 
        fetch(`/api/chat?id=${chatId}`, { method: 'DELETE' })
      );
      
      toast.promise(Promise.all(deletePromises), {
        loading: `Deleting ${selectedChats.length} chats...`,
        success: () => {
          mutate((history) => {
            if (history) {
              return history.filter((h) => !selectedChats.includes(h.id));
            }
          });
          setSelectedChats([]);
          setIsMultiSelectMode(false);
          return `${selectedChats.length} chats deleted successfully`;
        },
        error: 'Failed to delete chats',
      });
      
      setShowDeleteDialog(false);
      
      // If current chat is being deleted, redirect to home
      if (selectedChats.includes(id as string)) {
        router.push('/');
      }
      
      return;
    }
    
    // If deleting a single chat
    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: 'DELETE',
    });

    toast.promise(deletePromise, {
      loading: 'Deleting chat...',
      success: () => {
        mutate((history) => {
          if (history) {
            return history.filter((h) => h.id !== deleteId);
          }
        });
        return 'Chat deleted successfully';
      },
      error: 'Failed to delete chat',
    });

    setShowDeleteDialog(false);

    if (deleteId === id) {
      router.push('/');
    }
  };

  // Render multi-select controls when in multi-select mode
  const renderMultiSelectControls = () => {
    if (!isMultiSelectMode) return null;
    
    return (
      <div className="p-2 flex justify-between items-center border-b">
        <div className="text-xs font-medium">
          {selectedChats.length} selected
        </div>
        <div className="flex gap-2">
          <Button 
            variant="destructive" 
            size="sm" 
            onClick={handleDeleteMultiple}
            disabled={selectedChats.length === 0}
          >
            <StyledTrashIcon size={14} className="mr-1" />
            Delete
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={toggleMultiSelectMode}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-zinc-500 w-full flex flex-row justify-center items-center text-sm gap-2">
            Login to save and revisit previous chats!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <div className="px-2 py-1 text-xs text-sidebar-foreground/50">
          Today
        </div>
        <SidebarGroupContent>
          <div className="flex flex-col">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                key={item}
                className="rounded-md h-8 flex gap-2 px-2 items-center"
              >
                <div
                  className="h-4 rounded-md flex-1 max-w-[--skeleton-width] bg-sidebar-accent-foreground/10"
                  style={
                    {
                      '--skeleton-width': `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (history?.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="px-2 text-zinc-500 w-full flex flex-row justify-center items-center text-sm gap-2">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const groupChatsByDate = (chats: Chat[]): GroupedChats => {
    const now = new Date();
    const oneWeekAgo = subWeeks(now, 1);
    const oneMonthAgo = subMonths(now, 1);

    return chats.reduce(
      (groups, chat) => {
        const chatDate = new Date(chat.createdAt);

        if (isToday(chatDate)) {
          groups.today.push(chat);
        } else if (isYesterday(chatDate)) {
          groups.yesterday.push(chat);
        } else if (chatDate > oneWeekAgo) {
          groups.lastWeek.push(chat);
        } else if (chatDate > oneMonthAgo) {
          groups.lastMonth.push(chat);
        } else {
          groups.older.push(chat);
        }

        return groups;
      },
      {
        today: [],
        yesterday: [],
        lastWeek: [],
        lastMonth: [],
        older: [],
      } as GroupedChats,
    );
  };

  return (
    <>
      <SidebarGroup>
        <div className="flex justify-between items-center px-2 py-2">
          <div className="text-xs font-medium text-sidebar-foreground">History</div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={toggleMultiSelectMode}
            className="h-7 text-xs"
          >
            {isMultiSelectMode ? 'Cancel' : 'Select'}
          </Button>
        </div>
        
        {renderMultiSelectControls()}
        
        <SidebarGroupContent>
          <SidebarMenu>
            {history &&
              (() => {
                const groupedChats = groupChatsByDate(history);

                return (
                  <>
                    {groupedChats.today.length > 0 && (
                      <>
                        <div className="px-2 py-1 text-xs text-sidebar-foreground/50 flex items-center cursor-pointer hover:text-sidebar-foreground/70">
                          <span>Today</span>
                        </div>
                        {groupedChats.today.map((chat) => (
                          <ChatItem
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                            isSelected={selectedChats.includes(chat.id)}
                            onSelect={handleSelectChat}
                          />
                        ))}
                      </>
                    )}

                    {groupedChats.yesterday.length > 0 && (
                      <>
                        <div 
                          className="px-2 py-1 text-xs text-sidebar-foreground/50 mt-6 flex items-center cursor-pointer hover:text-sidebar-foreground/70"
                          onClick={() => toggleSection('yesterday')}
                        >
                          {collapsedSections.yesterday ? (
                            <ChevronRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          )}
                          <span>Yesterday</span>
                        </div>
                        {!collapsedSections.yesterday && groupedChats.yesterday.map((chat) => (
                          <ChatItem
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                            isSelected={selectedChats.includes(chat.id)}
                            onSelect={handleSelectChat}
                          />
                        ))}
                      </>
                    )}

                    {groupedChats.lastWeek.length > 0 && (
                      <>
                        <div 
                          className="px-2 py-1 text-xs text-sidebar-foreground/50 mt-6 flex items-center cursor-pointer hover:text-sidebar-foreground/70"
                          onClick={() => toggleSection('lastWeek')}
                        >
                          {collapsedSections.lastWeek ? (
                            <ChevronRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          )}
                          <span>Last 7 days</span>
                        </div>
                        {!collapsedSections.lastWeek && groupedChats.lastWeek.map((chat) => (
                          <ChatItem
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                            isSelected={selectedChats.includes(chat.id)}
                            onSelect={handleSelectChat}
                          />
                        ))}
                      </>
                    )}

                    {groupedChats.lastMonth.length > 0 && (
                      <>
                        <div 
                          className="px-2 py-1 text-xs text-sidebar-foreground/50 mt-6 flex items-center cursor-pointer hover:text-sidebar-foreground/70"
                          onClick={() => toggleSection('lastMonth')}
                        >
                          {collapsedSections.lastMonth ? (
                            <ChevronRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          )}
                          <span>Last 30 days</span>
                        </div>
                        {!collapsedSections.lastMonth && groupedChats.lastMonth.map((chat) => (
                          <ChatItem
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                            isSelected={selectedChats.includes(chat.id)}
                            onSelect={handleSelectChat}
                          />
                        ))}
                      </>
                    )}

                    {groupedChats.older.length > 0 && (
                      <>
                        <div 
                          className="px-2 py-1 text-xs text-sidebar-foreground/50 mt-6 flex items-center cursor-pointer hover:text-sidebar-foreground/70"
                          onClick={() => toggleSection('older')}
                        >
                          {collapsedSections.older ? (
                            <ChevronRight className="h-3 w-3 mr-1" />
                          ) : (
                            <ChevronDown className="h-3 w-3 mr-1" />
                          )}
                          <span>Older</span>
                        </div>
                        {!collapsedSections.older && groupedChats.older.map((chat) => (
                          <ChatItem
                            key={chat.id}
                            chat={chat}
                            isActive={chat.id === id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            setOpenMobile={setOpenMobile}
                            isSelected={selectedChats.includes(chat.id)}
                            onSelect={handleSelectChat}
                          />
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteId === 'multiple' 
                ? `This action cannot be undone. This will permanently delete ${selectedChats.length} chat${selectedChats.length > 1 ? 's' : ''} and remove them from our servers.`
                : 'This action cannot be undone. This will permanently delete your chat and remove it from our servers.'
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
