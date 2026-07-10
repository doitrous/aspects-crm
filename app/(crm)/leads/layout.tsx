/**
 * Hosts the leads list plus a parallel `@modal` slot. The slot is empty by
 * default (`@modal/default.tsx`); when a lead row is clicked the intercepting
 * route `@modal/(.)[id]` fills it with the slide-over drawer, keeping the list
 * mounted underneath and the URL shareable.
 */
export default function LeadsLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
