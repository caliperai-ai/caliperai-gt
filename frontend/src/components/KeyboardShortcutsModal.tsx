import { createPortal } from 'react-dom';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    shortcuts: [
      { keys: ['Esc'], description: 'Cancel current action / Close modal' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['←', '→'], description: 'Previous / Next frame' },
      { keys: ['Shift', '←', '→'], description: 'Jump 10 frames back/forward' },
      { keys: ['Home'], description: 'Go to first frame' },
      { keys: ['End'], description: 'Go to last frame' },
      { keys: ['Space'], description: 'Play / Pause' },
    ],
  },
  {
    title: 'Canvas Controls',
    shortcuts: [
      { keys: ['Scroll'], description: 'Zoom in/out' },
      { keys: ['Drag'], description: 'Pan canvas' },
      { keys: ['Double Click'], description: 'Zoom to fit / Reset view' },
      { keys: ['R'], description: 'Reset zoom to 100%' },
    ],
  },
  {
    title: 'Annotation Tools',
    shortcuts: [
      { keys: ['B'], description: 'Bounding Box tool' },
      { keys: ['P'], description: 'Polygon tool' },
      { keys: ['L'], description: 'Polyline tool' },
      { keys: ['K'], description: 'Keypoint tool' },
      { keys: ['V'], description: 'Select / Move tool' },
    ],
  },
  {
    title: 'Annotation Actions',
    shortcuts: [
      { keys: ['Delete'], description: 'Delete selected annotation' },
      { keys: ['Ctrl', 'C'], description: 'Copy annotation' },
      { keys: ['Ctrl', 'V'], description: 'Paste annotation' },
      { keys: ['Ctrl', 'Z'], description: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], description: 'Redo' },
      { keys: ['Ctrl', 'S'], description: 'Save annotations' },
    ],
  },
  {
    title: 'Task Actions',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], description: 'Submit task' },
      { keys: ['N'], description: 'Next task' },
    ],
  },
];

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd className="px-2 py-1 bg-gray-700 text-gray-200 text-xs rounded border border-gray-600 font-mono min-w-[24px] text-center">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-lg w-full max-w-2xl max-h-[80vh] mx-4 shadow-xl border border-gray-700 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-6">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-gray-300">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, keyIdx) => (
                          <span key={keyIdx} className="flex items-center">
                            <KeyBadge>{key}</KeyBadge>
                            {keyIdx < shortcut.keys.length - 1 && (
                              <span className="mx-1 text-gray-500">+</span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700">
          <p className="text-sm text-gray-400 text-center">
            Press <KeyBadge>?</KeyBadge> anywhere to show this help
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
}
