import LogoutButton from "../LogoutButton";
import WebCryptoE2EEDemo from "./Keys";

function Main() {
	return (
		<div className="w-full px-4 sm:px-6 md:px-0 flex flex-col items-center mt-6 space-y-6 max-w-4xl mx-auto h-auto p-6 bg-zinc-900/50 rounded-2xl border border-zinc-800 shadow-lg">
			<p
				className="mt-4 text-green-500 text-lg font-extrabold animate-fade-in duration-2000 tracking-widest
            animate-pulse"
				style={{
					textShadow: `
              0 0 5px currentColor,
              0 0 15px currentColor,
              0 0 40px rgba(0, 255, 80, 0.8),
              0 0 80px rgba(0, 255, 80, 0.6)
            `,
				}}
			>
				Your Keys Management Page
			</p>

			<WebCryptoE2EEDemo />

			<LogoutButton />
		</div>
	);
}

export default Main;
