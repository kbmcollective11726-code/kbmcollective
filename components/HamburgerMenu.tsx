import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
  ScrollView,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, usePathname, useNavigation } from 'expo-router';
import { isAppMenuItemVisible, isHamburgerTabShortcutVisible } from '../lib/effectiveEventMenu';
import { effectiveCanShowSessionCheckIn } from '../lib/rolePreview';
import { useRolePreviewStore } from '../stores/rolePreviewStore';
import { useRolePreviewContext } from '../hooks/useRolePreviewContext';
import { RolePreviewMenuButton, RolePreviewPicker } from './RolePreviewBanner';
import { navigateToFeedRoot } from '../lib/navigateToFeedRoot';
import { navigateToTabRoot } from '../lib/navigateToTabRoot';
import {
  X,
  Users,
  ImageIcon,
  LayoutGrid,
  Tv,
  User,
  Bell,
  Shield,
  LogOut,
  ChevronRight,
  Home,
  Calendar,
  Trophy,
  Store,
  Building2,
  BookOpen,
  QrCode,
  FileText,
  ClipboardCheck,
  MessageCircle,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { useAuthStore } from '../stores/authStore';
import { useEventStore } from '../stores/eventStore';
import { supabase, withRetryAndRefresh } from '../lib/supabase';
import { subscribeUserNotifications } from '../lib/notificationsRealtime';
import { registerRefetchOnSessionRefreshed } from '../lib/onSessionRefreshed';
import { setAppBadgeCount } from '../lib/pushNotifications';
import { fetchUnreadDmCount } from '../lib/unreadDmMessages';
import { colors } from '../constants/colors';
import { darkenThemeColor, useEventThemeColor } from '../lib/eventTheme';
import type { EventSponsor } from '../lib/types';
import { logSponsorClick, type SponsorClickPlacement } from '../lib/logSponsorClick';
import { openExternalUrl } from '../lib/openExternalUrl';
import { SponsorMark } from './SponsorMark';
import { useResolvedEventSponsors } from '../lib/useResolvedEventSponsors';

function getLiveWallBaseUrl(): string {
  const fromEnv =
    (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LIVE_WALL_URL
      ? String(process.env.EXPO_PUBLIC_LIVE_WALL_URL).trim().replace(/\/+$/, '')
      : '') || '';
  const extra = Constants.expoConfig?.extra as { liveWallUrl?: string } | undefined;
  const fromExtra = (extra?.liveWallUrl && String(extra.liveWallUrl).trim().replace(/\/+$/, '')) || '';
  return fromEnv || fromExtra || 'http://localhost:3000';
}

type HamburgerMenuProps = {
  onLogout?: () => void;
};

/** Crisp three-bar icon — Lucide `Menu` can look uneven at small header sizes. */
function HamburgerLines({ color, size = 18 }: { color: string; size?: number }) {
  const barHeight = Math.max(2, Math.round(size * 0.12));
  const barWidth = size;
  const gap = Math.max(3, Math.round(size * 0.2));
  return (
    <View style={{ width: barWidth, height: barHeight * 3 + gap * 2, justifyContent: 'space-between' }}>
      {[0, 1, 2].map((key) => (
        <View
          key={key}
          style={{
            width: barWidth,
            height: barHeight,
            borderRadius: barHeight / 2,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

export default function HamburgerMenu({ onLogout }: HamburgerMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadChats, setUnreadChats] = useState(0);
  const [isEventAdmin, setIsEventAdmin] = useState(false);
  const [isVendorRep, setIsVendorRep] = useState(false);
  const [rolePreviewOpen, setRolePreviewOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuthStore();
  const { currentEvent, adminCheckTick } = useEventStore();
  const themeColor = useEventThemeColor();
  const previewRole = useRolePreviewStore((s) => s.previewRole);
  const { applyEventAdmin, applyVendorRep } = useRolePreviewContext();
  const isPlatformAdmin = user?.is_platform_admin === true;
  const effectiveIsEventAdmin = applyEventAdmin(isEventAdmin);
  const effectiveIsVendorRep = applyVendorRep(isVendorRep);
  const { sponsors: sponsorsMenuHeader } = useResolvedEventSponsors(
    currentEvent?.id,
    'hamburger_header',
    currentEvent?.reminder_timezone,
    { enabled: visible, refreshKey: visible }
  );
  const { sponsors: sponsorsMenuFooter } = useResolvedEventSponsors(
    currentEvent?.id,
    'hamburger_footer',
    currentEvent?.reminder_timezone,
    { enabled: visible, refreshKey: visible }
  );

  const fetchUnreadCount = useCallback(() => {
    if (!user?.id) return;
    if (!currentEvent?.id) {
      setUnreadNotifications(0);
      setAppBadgeCount(0);
      return;
    }
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
      .eq('event_id', currentEvent.id)
      .neq('type', 'message')
      .then(({ count }) => {
        const n = count ?? 0;
        setUnreadNotifications(n);
        setAppBadgeCount(n);
      });
  }, [user?.id, currentEvent?.id]);

  const fetchUnreadChats = useCallback(() => {
    if (!user?.id) {
      setUnreadChats(0);
      return;
    }
    if (!currentEvent?.id) {
      setUnreadChats(0);
      return;
    }
    void fetchUnreadDmCount(currentEvent.id, user.id)
      .then((n) => setUnreadChats(n))
      .catch(() => {
        /* keep previous */
      });
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchUnreadCount();
    fetchUnreadChats();
  }, [fetchUnreadCount, fetchUnreadChats]);

  useEffect(() => {
    if (visible) {
      fetchUnreadCount();
      fetchUnreadChats();
    }
  }, [visible, fetchUnreadCount, fetchUnreadChats]);

  useEffect(() => {
    if (!user?.id) return;
    return subscribeUserNotifications(user.id, {
      onInsert: () => { fetchUnreadCount(); },
      onUpdate: () => { fetchUnreadCount(); },
    });
  }, [user?.id, fetchUnreadCount]);

  useEffect(() => {
    if (!user?.id || !currentEvent?.id) return;
    const channel = supabase
      .channel(`hamburger-unread-dms:${currentEvent.id}:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${user.id}`,
        },
        () => {
          fetchUnreadChats();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, currentEvent?.id, fetchUnreadChats]);

  const tryAnyEventAdmin = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    try {
      const data = await withRetryAndRefresh(async () => {
        const { data: d, error } = await supabase
          .from('event_members')
          .select('event_id')
          .eq('user_id', user.id)
          .in('role', ['admin', 'super_admin'])
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return d;
      });
      setIsEventAdmin(data != null);
    } catch {
      // keep previous state on error so Event admin menu doesn't disappear
    }
  }, [user?.id]);

  const fetchEventAdminStatus = useCallback(async () => {
    if (!user?.id) {
      setIsEventAdmin(false);
      return;
    }
    if (currentEvent?.id) {
      try {
        const data = await withRetryAndRefresh(async () => {
          const { data: d, error } = await supabase
            .from('event_members')
            .select('role, roles')
            .eq('event_id', currentEvent.id)
            .eq('user_id', user.id)
            .maybeSingle();
          if (error) throw error;
          return d;
        });
        const row = data as { role?: string; roles?: string[] } | null;
        const role = row?.role ?? 'attendee';
        const roles = Array.isArray(row?.roles) ? row.roles : [];
        setIsEventAdmin(role === 'admin' || role === 'super_admin' || roles.includes('admin') || roles.includes('super_admin'));
      } catch {
        await tryAnyEventAdmin();
      }
      return;
    }
    await tryAnyEventAdmin();
  }, [user?.id, currentEvent?.id, tryAnyEventAdmin]);

  const fetchVendorRepStatus = useCallback(async () => {
    if (!user?.id || !currentEvent?.id) {
      setIsVendorRep(false);
      return;
    }
    try {
      const repsRes = await supabase
        .from('vendor_booth_reps')
        .select('booth_id, vendor_booths!inner(event_id)')
        .eq('user_id', user.id)
        .eq('vendor_booths.event_id', currentEvent.id);
      if (!repsRes.error && (repsRes.data?.length ?? 0) > 0) {
        setIsVendorRep(true);
        return;
      }
      const legacy = await supabase
        .from('vendor_booths')
        .select('id')
        .eq('event_id', currentEvent.id)
        .eq('contact_user_id', user.id)
        .limit(1)
        .maybeSingle();
      setIsVendorRep(!legacy.error && legacy.data != null);
    } catch {
      setIsVendorRep(false);
    }
  }, [user?.id, currentEvent?.id]);

  useEffect(() => {
    fetchEventAdminStatus();
  }, [fetchEventAdminStatus, adminCheckTick]);

  useEffect(() => {
    fetchVendorRepStatus();
  }, [fetchVendorRepStatus, adminCheckTick]);

  useEffect(() => {
    return registerRefetchOnSessionRefreshed(() => {
      if (!user?.id) return;
      fetchEventAdminStatus();
      fetchVendorRepStatus();
    });
  }, [user?.id, fetchEventAdminStatus, fetchVendorRepStatus]);

  // Refetch when menu opens so she always sees latest role (e.g. just made admin, or event selected after load)
  useEffect(() => {
    if (visible && user?.id) {
      fetchEventAdminStatus();
      fetchVendorRepStatus();
    }
  }, [visible, user?.id, fetchEventAdminStatus, fetchVendorRepStatus]);

  const close = () => setVisible(false);

  const navigate = (path: string) => {
    close();
    router.push(path as never);
  };

  /** Prefer tab navigator so menu items don’t stack poison history for Back. */
  const navigateTab = (tabName: string, pathFallback: string) => {
    close();
    try {
      navigateToTabRoot(tabName, navigation);
      return;
    } catch {
      /* fall through */
    }
    router.navigate(pathFallback as never);
  };

  // For profile sub-pages, pass current path so back button returns to the page user was on
  const returnTo = pathname && pathname !== '/' ? pathname : '/(tabs)/home';
  const navigateToProfileScreen = (screen: string) => {
    close();
    router.push(`${screen}?from=${encodeURIComponent(returnTo)}` as never);
  };

  const handleLogout = async () => {
    close();
    try {
      await logout();
      onLogout?.();
      router.replace('/(auth)/login');
    } catch {
      router.replace('/(auth)/login');
    }
  };

  const openLiveWall = () => {
    close();
    const base = getLiveWallBaseUrl();
    const url = currentEvent?.id ? `${base}/wall?event=${currentEvent.id}` : base;
    Linking.openURL(url).catch(() => {});
  };

  /** Slightly narrower drawer — easier to scan, less “wide sheet” on phone. */
  const menuWidth = Math.min(width * 0.7, 288);
  /** Match `CompactSponsorStrip` stacked row height for the drawer width. */
  const footerSponsorLogoH = Math.min(120, Math.max(72, Math.round(menuWidth / 3.35)));

  const openSponsorLink = useCallback(
    async (s: EventSponsor, placement: SponsorClickPlacement) => {
      if (!s.website_url?.trim()) return;
      const opened = await openExternalUrl(s.website_url);
      if (opened && currentEvent?.id) {
        void logSponsorClick({ eventId: currentEvent.id, sponsorId: s.id, placement });
      }
    },
    [currentEvent?.id]
  );

  const openMenu = () => {
    setVisible(true);
    // Refetch admin status as soon as they open the menu so "Event admin" shows for admins
    fetchEventAdminStatus();
  };

  return (
    <>
      <TouchableOpacity
        onPress={openMenu}
        style={styles.trigger}
        hitSlop={12}
        activeOpacity={0.85}
        accessibilityLabel="Open menu"
        accessibilityRole="button"
      >
        <HamburgerLines color={themeColor} size={20} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="slide">
        <Pressable style={styles.overlay} onPress={close}>
          <Pressable
            style={[styles.drawer, { width: menuWidth, paddingTop: insets.top }]}
            onPress={(e) => e.stopPropagation()}
          >
            <LinearGradient
              colors={[themeColor, darkenThemeColor(themeColor, 0.88)]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.drawerAccent}
            />
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeaderLeft}>
                <Text style={styles.drawerTitle}>Menu</Text>
                {sponsorsMenuHeader.slice(0, 2).map((s, i) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.headerSponsorBtn, i > 0 ? { marginLeft: 8 } : null]}
                    onPress={() => openSponsorLink(s, 'hamburger_header')}
                    activeOpacity={s.website_url ? 0.75 : 1}
                    disabled={!s.website_url}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityLabel={s.company_name}
                    accessibilityRole={s.website_url ? 'link' : 'text'}
                  >
                    {s.logo_url?.trim() ? (
                      <View style={styles.headerSponsorImageWrap} pointerEvents="none">
                        <SponsorMark uri={s.logo_url} style={styles.headerSponsorImg} />
                      </View>
                    ) : (
                      <Text style={styles.headerSponsorName} numberOfLines={1}>
                        {s.company_name}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.drawerHeaderClose}>
                <TouchableOpacity
                  onPress={close}
                  hitSlop={12}
                  style={styles.closeBtn}
                  activeOpacity={0.8}
                  accessibilityLabel="Close menu"
                >
                  <X size={18} color={colors.textSecondary} strokeWidth={2.25} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              style={styles.menuList}
              contentContainerStyle={styles.menuListContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Tab shortcuts — usually off (tabs cover these); kept for rare platform enable. */}
              {isHamburgerTabShortcutVisible(currentEvent, 'platform_hamburger_show_info') && (
                <MenuItem themeColor={themeColor} icon={Home} label="Info" onPress={() => navigateTab('home', '/(tabs)/home')} />
              )}
              {isHamburgerTabShortcutVisible(currentEvent, 'platform_hamburger_show_feed') && (
                <MenuItem
                  themeColor={themeColor}
                  icon={ImageIcon}
                  label="Feed"
                  onPress={() => {
                    close();
                    // Pass tab navigation so Feed opens from any other tab (Community, etc.).
                    navigateToFeedRoot(navigation);
                  }}
                />
              )}
              {isHamburgerTabShortcutVisible(currentEvent, 'platform_hamburger_show_agenda') && (
                <MenuItem themeColor={themeColor} icon={Calendar} label="Agenda" onPress={() => navigateTab('schedule', '/(tabs)/schedule')} />
              )}
              {isHamburgerTabShortcutVisible(currentEvent, 'platform_hamburger_show_community') && (
                <MenuItem themeColor={themeColor} icon={Users} label="Community" onPress={() => navigateTab('community', '/(tabs)/community')} />
              )}
              {isHamburgerTabShortcutVisible(currentEvent, 'platform_hamburger_show_rank') && (
                <MenuItem themeColor={themeColor} icon={Trophy} label="Rank" onPress={() => navigateTab('leaderboard', '/(tabs)/leaderboard')} />
              )}

              {/* Connect + event extras (typical hamburger when tab shortcuts are off) */}
              <MenuItem
                themeColor={themeColor}
                icon={MessageCircle}
                label="Chat"
                badge={unreadChats > 0 ? unreadChats : undefined}
                onPress={() => navigateToProfileScreen('/profile/messages')}
              />
              {isAppMenuItemVisible(currentEvent, 'menu_show_solution_providers') && (
                <MenuItem
                  themeColor={themeColor}
                  icon={Building2}
                  label="Solution Providers"
                  onPress={() =>
                    navigate(
                      `/(tabs)/solution-providers?from=${encodeURIComponent(returnTo)}` as never
                    )
                  }
                />
              )}
              {isAppMenuItemVisible(currentEvent, 'menu_show_1on1') && (
                <MenuItem themeColor={themeColor} icon={Store} label="1:1 Meetings" onPress={() => navigateTab('expo', '/(tabs)/expo')} />
              )}
              <MenuItem themeColor={themeColor} icon={LayoutGrid} label="Photo book" onPress={() => navigateTab('photo-book', '/(tabs)/photo-book')} />
              {isAppMenuItemVisible(currentEvent, 'menu_show_live_wall') && (
                <MenuItem themeColor={themeColor} icon={Tv} label="Live wall" onPress={openLiveWall} />
              )}

              {(isAppMenuItemVisible(currentEvent, 'menu_show_scan_badge') ||
                effectiveCanShowSessionCheckIn(currentEvent, isEventAdmin, isPlatformAdmin, previewRole) ||
                (currentEvent?.id &&
                  (effectiveIsEventAdmin || effectiveIsVendorRep) &&
                  isAppMenuItemVisible(currentEvent, 'menu_show_notes'))) && (
                <View style={styles.divider} />
              )}
              {isAppMenuItemVisible(currentEvent, 'menu_show_scan_badge') && (
                <MenuItem
                  themeColor={themeColor}
                  icon={QrCode}
                  label="Scan badge"
                  onPress={() => navigateToProfileScreen('/profile/badge-scan')}
                />
              )}
              {effectiveCanShowSessionCheckIn(currentEvent, isEventAdmin, isPlatformAdmin, previewRole) && (
                <MenuItem
                  themeColor={themeColor}
                  icon={ClipboardCheck}
                  label="Session check-in"
                  onPress={() =>
                    navigate(`/(tabs)/profile/session-check-in?from=${encodeURIComponent(returnTo)}` as never)
                  }
                />
              )}
              {currentEvent?.id &&
                (effectiveIsEventAdmin || effectiveIsVendorRep) &&
                isAppMenuItemVisible(currentEvent, 'menu_show_notes') && (
                  <MenuItem
                    themeColor={themeColor}
                    icon={FileText}
                    label="Notes"
                    onPress={() => navigateToProfileScreen('/profile/badge-notes')}
                  />
                )}

              <View style={styles.divider} />
              <MenuItem
                themeColor={themeColor}
                icon={User}
                label="My profile"
                onPress={() => navigateTab('profile', '/(tabs)/profile')}
              />
              <MenuItem
                themeColor={themeColor}
                icon={Bell}
                label="Notifications"
                badge={unreadNotifications > 0 ? unreadNotifications : undefined}
                onPress={() => navigateToProfileScreen('/profile/notifications')}
              />
              <MenuItem
                themeColor={themeColor}
                icon={BookOpen}
                label="How to use"
                onPress={() => navigateToProfileScreen('/profile/user-guide')}
              />
              {effectiveIsEventAdmin && user && (
                <MenuItem
                  themeColor={themeColor}
                  icon={Shield}
                  label="Event admin"
                  onPress={() => navigateToProfileScreen('/profile/admin')}
                />
              )}
              {isPlatformAdmin ? (
                <>
                  <View style={styles.divider} />
                  <RolePreviewMenuButton onPress={() => setRolePreviewOpen(true)} />
                </>
              ) : null}
              <View style={styles.divider} />
              <MenuItem
                themeColor={themeColor}
                icon={LogOut}
                label="Logout"
                onPress={handleLogout}
                destructive
                labelStyle={styles.logoutLabel}
              />
              {sponsorsMenuFooter.length > 0 ? (
                <View style={styles.sponsorMenuSection}>
                  <View style={styles.sponsorMenuStrip}>
                    <Text style={styles.sponsorMenuTitle}>Mobile app sponsored by</Text>
                    {sponsorsMenuFooter.map((s, i) => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.sponsorFooterRow, i > 0 ? styles.sponsorFooterRowSpacing : null]}
                        onPress={() => openSponsorLink(s, 'hamburger_footer')}
                        activeOpacity={s.website_url ? 0.75 : 1}
                        disabled={!s.website_url}
                        accessibilityLabel={s.company_name}
                      >
                        {s.tier_label ? <Text style={styles.sponsorMenuTier}>{s.tier_label}</Text> : null}
                        {s.logo_url?.trim() ? (
                          <View style={[styles.sponsorFooterLogoShell, { height: footerSponsorLogoH }]}>
                            <SponsorMark uri={s.logo_url} style={styles.sponsorFooterLogoImg} />
                          </View>
                        ) : (
                          <Text style={styles.sponsorMenuName} numberOfLines={2}>
                            {s.company_name}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.bottomSpacer} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <RolePreviewPicker visible={rolePreviewOpen} onClose={() => setRolePreviewOpen(false)} />
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  labelStyle,
  badge,
  themeColor,
  destructive,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  onPress: () => void;
  labelStyle?: object;
  badge?: number;
  themeColor: string;
  destructive?: boolean;
}) {
  const iconColor = destructive ? colors.danger : themeColor;

  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Icon size={20} color={iconColor} strokeWidth={2} />
      <Text style={[styles.menuItemLabel, labelStyle]}>{label}</Text>
      {badge != null && badge > 0 && (
        <View style={[styles.badge, { backgroundColor: themeColor }]}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
      <ChevronRight size={18} color={colors.textLight} strokeWidth={2} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  trigger: {
    padding: 8,
    marginLeft: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  drawer: {
    backgroundColor: colors.card,
    marginRight: 0,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: colors.shadowColor,
        shadowOffset: { width: 4, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  drawerAccent: {
    height: 3,
    width: '100%',
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    minHeight: 48,
    backgroundColor: colors.card,
  },
  /** “Menu” + inline sponsor mark(s) on the same row, left side. */
  drawerHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 0,
    marginRight: 10,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSponsorBtn: {
    width: 108,
    height: 34,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSponsorImageWrap: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerSponsorImg: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  headerSponsorName: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 72,
  },
  drawerHeaderClose: {
    flexShrink: 0,
  },
  menuList: {
    flex: 1,
  },
  menuListContent: {
    paddingTop: 4,
    paddingBottom: 70,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 12,
  },
  menuItemLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  logoutLabel: {
    color: colors.danger,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderLight,
    marginVertical: 4,
    marginHorizontal: 16,
  },
  bottomSpacer: {
    height: 14,
  },
  /** Full drawer width — inner strip matches Feed / Info `CompactSponsorStrip` band. */
  sponsorMenuSection: {
    width: '100%',
    paddingTop: 6,
    paddingBottom: 4,
    marginTop: 4,
  },
  sponsorMenuStrip: {
    width: '100%',
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
    paddingBottom: 16,
  },
  sponsorMenuTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.3,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  sponsorFooterRow: {
    width: '100%',
    alignItems: 'stretch',
    paddingHorizontal: 6,
  },
  sponsorFooterRowSpacing: {
    marginTop: 12,
  },
  sponsorMenuTier: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 6,
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
    paddingHorizontal: 16,
  },
  sponsorFooterLogoShell: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  sponsorFooterLogoImg: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  sponsorMenuName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
