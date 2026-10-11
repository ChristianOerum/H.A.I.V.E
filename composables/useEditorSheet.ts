/**
 * How many pixels of the viewport the settings panel covers.
 *
 * md and up it is a right-hand side panel (`right`); on phones in portrait it
 * is a bottom sheet (`inset`, its height). FloorplanEditorPanel measures it
 * and writes the value here; the 2D room editor shrinks above the sheet and
 * the 3D camera shifts its view so the floorplan stays centred in the part of
 * the screen that is still visible. Both are zero while the panel is closed.
 */
export function useEditorSheet() {
  const inset = useState('editorSheetInset', () => 0)
  const right = useState('editorSheetRight', () => 0)
  return { inset, right }
}
