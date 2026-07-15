import bgImage from "@/assets/bg.svg";

export function Background() {
  return (
    <div className="fixed inset-0 -z-10 w-full h-full bg-[#050505] overflow-hidden">
      <img
        src={bgImage}
        alt="Background"
        className="absolute w-full h-full object-cover opacity-80"
      />
    </div>
  );
}
