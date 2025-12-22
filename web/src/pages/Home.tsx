import Main from "../components/keys/Main";
import Form from "../components/login/Form";
import LogoutButton from "../components/LogoutButton";
import { useAuth } from "../context/useUser";

export default function Home() {
	const { connected, page, setPage } = useAuth();

	return (
		<div className="flex items-center justify-center flex-col bg-linear-to-br from-black via-slate-950 to-purple-950 flex-wrap min-h-screen p-6">
			<h1
				className="
					text-red-500
					font-extrabold
					text-8xl
					tracking-widest
					animate-pulse
				"
				style={{
					textShadow: `
						0 0 5px currentColor,
						0 0 15px currentColor,
						0 0 40px rgba(255, 0, 80, 0.8),
						0 0 80px rgba(255, 0, 80, 0.6)
					`,
				}}
			>
				RELAY!
			</h1>
			<p
				className="mt-4 text-white text-lg font-extrabold animate-fade-in duration-2000 tracking-widest
					animate-pulse"
				style={{
					textShadow: `
						0 0 5px currentColor,
						0 0 15px currentColor,
						0 0 40px rgba(255, 0, 80, 0.8),
						0 0 80px rgba(255, 0, 80, 0.6)
					`,
				}}
			>
				Securely connecting clients with end-to-end encryption.
			</p>
			{connected && page === "dashboard" && (
				<div className="flex flex-col items-center justify-center mt-6">
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
						You are now connected!
					</p>
					<div className="flex items-center justify-center mt-6">
						<button
							className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mr-4"
							onClick={() => setPage("keys")}
						>
							Go to Keys Management
						</button>
						<LogoutButton />
					</div>
				</div>
			)}
			{connected && page === "keys" && <Main />}
			{!connected && page === "login" && <Form />}
		</div>
	);
}
