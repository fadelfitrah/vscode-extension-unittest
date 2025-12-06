usecaseDiagram
actor "Developer" as Dev
actor "AI Service Provider\n(OpenAI/Groq/dll)" as AI
actor "Python Runtime\n(Coverage)" as PyEnv

    package "VS Code Extension\n(Unittest Generator)" {
        usecase "Select Python File" as UC1
        usecase "Configure Test Settings" as UC2
        usecase "Generate Unit Tests" as UC3
        usecase "Analyze Test Quality" as UC4
        usecase "Save Test File" as UC5
        usecase "Run Coverage Report" as UC6
        usecase "View History/Log" as UC7
    }

    %% Relasi Utama
    Dev --> UC1
    Dev --> UC2
    Dev --> UC3
    Dev --> UC4
    Dev --> UC5
    Dev --> UC6

    %% Ketergantungan (Includes/Extends)
    UC3 ..> UC1 : <<include>>
    UC3 ..> UC2 : <<include>>
    UC5 ..> UC3 : <<extend>>

    %% Interaksi Eksternal
    UC3 --> AI : Mengirim Prompt Code
    UC6 --> PyEnv : Eksekusi 'coverage run'

    %% Detail Configuration (Opsional untuk konteks)
    note right of UC2
        - Pilih Model AI
        - Toggle Mocking
        - Set Coverage Target
        - Pilih Style (Given-When-Then)
    end note
