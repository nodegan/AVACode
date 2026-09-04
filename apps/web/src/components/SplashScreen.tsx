export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="AVA Code splash screen">
        <img alt="AVA Code" className="block size-16 object-contain dark:hidden" src="/logo.svg" />
        <img
          alt=""
          aria-hidden
          className="hidden size-16 object-contain dark:block"
          src="/logo-dark.svg"
        />
      </div>
    </div>
  );
}
