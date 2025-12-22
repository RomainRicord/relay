import { useAuth } from "../../context/useUser";
import SubmitEvent from "./Submit";

function Form() {
	const {
		userInput,
		setUserInput,
		setConnected,
		setPage,
		result,
		step,
		userId,
		setResult,
		setStep,
		setUserId,
		setQr,
		qr,
	} = useAuth();

	return (
		<form
			className="flex items-center justify-center flex-col mt-8 tracking-widest
					animate-pulse"
			style={{
				textShadow: `
          0 0 5px currentColor,
          0 0 15px currentColor,
          0 0 40px rgba(255, 0, 80, 0.8),
          0 0 80px rgba(255, 0, 80, 0.6)
        `,
			}}
			onSubmit={(e) => {
				SubmitEvent(
					e,
					step!,
					userInput!,
					setResult!,
					userId!,
					setConnected!,
					setQr!,
					setUserId!,
					setStep!,
					setPage!
				);
			}}
		>
			{result?.message && result.message !== "" && (
				<div
					className={`mt-4 p-3 rounded-lg ${
						result.code === 200 ? "bg-green-500" : "bg-red-500"
					} text-white font-bold`}
				>
					{result.message}
				</div>
			)}
			{step === "ENROLL" && qr && (
				<div className="mt-4 bg-white p-3 rounded-lg">
					<img
						src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
							qr
						)}`}
						alt="A2F QR Code"
					/>
				</div>
			)}

			{(step === "ENROLL" || step === "A2F") && (
				<input
					type="text"
					placeholder="Enter your 2FA code"
					value={userInput?.a2f}
					onChange={(e) =>
						setUserInput?.({
							email: userInput?.email || "",
							a2f: e.target.value,
						})
					}
					className="mt-6 p-3 text-white  rounded-t-lg border-2 border-purple-500 focus:outline-none w-64"
				/>
			)}

			{step === "EMAIL" && (
				<input
					type="text"
					placeholder="Enter your email"
					value={userInput?.email}
					onChange={(e) =>
						setUserInput?.({
							a2f: userInput?.a2f || "",
							email: e.target.value,
						})
					}
					className="mt-6 p-3 text-white rounded-t-lg border-2 border-purple-500 focus:outline-none w-64"
				/>
			)}

			<button className="p-3 bg-purple-600 text-white font-bold rounded-b-lg hover:bg-purple-700 transition-colors duration-300 w-64 mt-4 md:mt-0">
				Connect Now
			</button>
		</form>
	);
}
export default Form;
