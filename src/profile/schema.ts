// 사용자 이력 스키마 (MVP: 인적사항, 학력, 자격증).
// 날짜는 모두 "YYYY-MM-DD" 문자열로 저장하고, 사이트 형식으로의 변환은 Filler가 담당한다.

export type Personal = {
  name?: string;
  gender?: "남" | "여";
  birthday?: string;
  phone?: string;
  email?: string;
  address?: {
    zipCode?: string;
    address?: string;
    detail?: string;
  };
};

export type EducationLevel = "고등학교" | "대학교" | "대학원";

export type Education = {
  level: EducationLevel;
  school: string;
  major?: string;
  degree?: string; // 학사, 전문학사, 석사, 박사
  entranceDate?: string;
  graduationDate?: string;
  entranceType?: string; // 입학, 편입
  status?: string; // 졸업, 졸업예정, 재학, 휴학, 중퇴, 수료
  gpa?: number;
  gpaScale?: number;
};

export type Certificate = {
  name: string;
  issuer?: string;
  registrationNumber?: string;
  acquiredDate?: string;
};

export type Profile = {
  personal?: Personal;
  education?: Education[];
  certificates?: Certificate[];
};

// Classifier가 필드에 붙이는 슬롯 키. "엔티티.속성" 형식.
export const SLOT_KEYS = [
  "personal.name",
  "personal.gender",
  "personal.birthday",
  "personal.phone",
  "personal.email",
  "personal.address.zipCode",
  "personal.address.address",
  "personal.address.detail",
  "education.school",
  "education.major",
  "education.degree",
  "education.entranceDate",
  "education.graduationDate",
  "education.entranceType",
  "education.status",
  "education.gpa",
  "education.gpaScale",
  "certificates.name",
  "certificates.issuer",
  "certificates.registrationNumber",
  "certificates.acquiredDate",
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];
