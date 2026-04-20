import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Statement upload card data
const statementCards = [
  {
    id: "mpesa",
    iconSrc: "/figmaAssets/background-1.svg",
    iconAlt: "M-Pesa icon",
    title: "M-Pesa statement",
    subtitle: "PDF FORMAT PREFERRED",
  },
  {
    id: "bank",
    iconSrc: "/figmaAssets/background-3.svg",
    iconAlt: "Bank icon",
    title: "Bank statement (optional)",
    subtitle: "SUPPORT FOR ALL MAJOR BANKS",
  },
];

export const StatementUpload = (): JSX.Element => {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-col min-h-[1089px] items-center bg-[#f9f9f9]">
      {/* Navigation Bar */}
      <header className="flex max-w-screen-xl h-16 items-center justify-between px-6 py-0 w-full">
        <div className="inline-flex flex-col items-start flex-[0_0_auto]">
          <span className="[font-family:'Inter',Helvetica] font-medium text-teal-900 text-xl tracking-[-1.00px] leading-7 whitespace-nowrap">
            Rafiki
          </span>
        </div>
        <img
          className="w-8 h-8"
          alt="Background"
          src="/figmaAssets/background-2.svg"
        />
      </header>
      {/* Main Content */}
      <main className="flex flex-col max-w-md items-center justify-center gap-10 px-5 py-[57px] w-full flex-[0_0_auto]">
        {/* Hero Section */}
        <section className="flex flex-col items-center w-full gap-4">
          {/* Top icon */}
          <img
            className="w-14 h-[55px]"
            alt="Background"
            src="/figmaAssets/background.svg"
          />
          {/* Heading */}
          <h1 className="[font-family:'Inter',Helvetica] font-medium text-[#1a1c1c] text-2xl text-center tracking-[-0.48px] leading-[30px] mt-4">
            Let me learn about your money
            <br />
            first.
          </h1>
          {/* Subtitle */}
          <p className="[font-family:'Inter',Helvetica] font-normal text-[#3f4945] text-base text-center tracking-[0] leading-[26px]">
            Upload your latest statements so I can
            <br />
            help you budget and save smarter.
          </p>
        </section>
        {/* Upload Cards */}
        <div className="flex flex-col items-start gap-6 self-stretch w-full flex-[0_0_auto]">
          {statementCards.map((card) => (
            <Card
              key={card.id}
              className="relative self-stretch w-full h-[167px] bg-white rounded-3xl border-0 overflow-hidden cursor-pointer"
            >
              <CardContent className="p-0 w-full h-full">
                {/* Background image fill */}
                <img
                  className="absolute top-0 left-0 w-full h-[167px] object-cover"
                  alt="Image fill"
                  src="/figmaAssets/image-fill.svg"
                />
                {/* Upload icon */}
                <img
                  className="absolute top-[calc(50%_-_52px)] left-[calc(50%_-_24px)] w-12 h-12"
                  alt={card.iconAlt}
                  src={card.iconSrc}
                />
                {/* Card label */}
                <div className="inline-flex flex-col items-center absolute top-[calc(50%_+_13px)] left-1/2 -translate-x-1/2">
                  <span className="[font-family:'Inter',Helvetica] font-normal text-[#1a1c1c] text-base text-center tracking-[0] leading-6 whitespace-nowrap">
                    {card.title}
                  </span>
                  <span className="[font-family:'Inter',Helvetica] font-medium text-[#3f4945] text-[10px] text-center tracking-[0.50px] leading-[15px] whitespace-nowrap">
                    {card.subtitle}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        {/* Action Buttons */}
        <div className="flex flex-col items-center gap-8 pt-4 self-stretch w-full flex-[0_0_auto]">
          {/* Continue Button */}
          <Button
            onClick={() => setLocation("/analyzing")}
            className="h-14 w-full rounded-full shadow-[0px_1px_2px_#0000000d] bg-[linear-gradient(179deg,rgba(0,52,43,1)_0%,rgba(0,77,64,1)_100%)] [font-family:'Inter',Helvetica] font-medium text-white text-base tracking-[0] leading-6 hover:opacity-90 border-0"
          >
            Continue
          </Button>
          {/* Skip for now */}
          <button
            onClick={() => setLocation("/reveal")}
            className="[font-family:'Inter',Helvetica] font-normal text-[#3f4945] text-sm tracking-[0.35px] leading-5 whitespace-nowrap bg-transparent border-0 cursor-pointer"
          >
            Skip for now
          </button>
        </div>
      </main>
      {/* Privacy Notice */}
      <section className="flex flex-col max-w-md items-start pt-4 pb-10 px-6 w-full flex-[0_0_auto]">
        <div className="flex items-center gap-4 p-4 self-stretch w-full flex-[0_0_auto] bg-[#f3f3f3] rounded-2xl">
          <img
            className="flex-[0_0_auto]"
            alt="Container"
            src="/figmaAssets/container.svg"
          />
          <p className="[font-family:'Inter',Helvetica] font-normal text-[#3f4945] text-xs tracking-[0] leading-[15px]">
            Your data is encrypted and private. Rafiki never
            <br />
            shares your financial information with third
            <br />
            parties.
          </p>
        </div>
      </section>
    </div>
  );
};
